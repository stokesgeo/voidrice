/*
 * codex-box: run one program inside a box built from unveil(2) and pledge(2),
 * or serve a small doas relay for programs in such a box.  cdxb(1) in
 * ~/.local/bin is the front end; this file is the part that must be C,
 * because unveil and pledge are system calls with no command of their own.
 *
 *	codex-box [-p pidfile] [-u perms:path ...] program [arg ...]
 *	codex-box -D socket
 *	codex-box -C socket word ...
 *
 * How the box works, in the order the kernel sees it:
 *
 * 1. unveil(path, perms) for each -u.  The first call hides the whole
 *    file system; each call opens one path again with some of r (read),
 *    w (write), x (execute) and c (create and remove).  An empty perms
 *    string hides a path inside a directory that was opened: the most
 *    specific unveil wins.
 * 2. unveil(NULL, NULL) locks the list.  Later unveil calls fail, in this
 *    process and in every process it starts.
 * 3. pledge(promises, execpromises).  The first string limits this
 *    launcher.  The second is the one that matters: it is the set of
 *    system-call groups the NEXT program starts with, after execve(2).
 * 4. execvp(program).
 *
 * Why step 3 is needed at all: execve(2) normally wipes the unveil list,
 * so the new program would see everything.  The kernel keeps the list
 * across execve only when execpromises are set (sys/kern/kern_exec.c:
 * "if (pr->ps_flags & PS_EXECPLEDGE) ... else ... unveil_destroy(pr)").
 * fork(2) copies both the list and the execpromises to every child
 * (unveil_copy() and PS_FLAGS_INHERITED_ON_FORK), so Codex and every
 * command it runs stay in the same box.
 *
 * The execpromises below are deliberately wide: they carry the box across
 * execve and should not break a coding agent.  "error" makes a forbidden
 * call fail with ENOSYS instead of killing the process, and makes a
 * pledge(2) call that asks for more succeed without granting it.
 * What the box still forbids: files outside the unveiled paths, ptrace of
 * your other processes, and running setuid programs (the kernel refuses
 * setuid execve under execpromises), so doas and su cannot run inside.
 * That last rule is why the relay below exists.
 *
 * The relay (-D) runs OUTSIDE the box.  It listens on a unix socket that
 * the box can reach, reads one line "command arg ...", and runs
 * "/usr/bin/doas -n -- command arg ...".  doas -n never asks for a
 * password and fails for any rule without nopass, even when a doas
 * persist ticket is live, so the owner's doas.conf nopass rules are the
 * whole list of what the relay can do.  It sends back the output and a
 * last line "cdxb: exit N".
 *
 * The client (-C) runs INSIDE the box: `cdxb doas` calls it.  It sends
 * its words as one request line, copies the relay's answer to standard
 * output without that last line, and exits with the status it gives.
 * It exists because nc(1) cannot do this in the box: nc -U calls
 * unveil(2) for its socket (usr.bin/nc/netcat.c), which fails once the
 * box has locked the list.  The client calls no unveil of its own; the
 * box already lets it reach the socket (cdxb unveils it "rw").
 */

#include <sys/types.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>

#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef __OpenBSD__
/*
 * Stubs so the file builds for a syntax check on other systems.
 * They confine nothing: on those systems the "box" is no box at all.
 */
static int
pledge(const char *promises, const char *execpromises)
{
	(void)promises;
	(void)execpromises;
	return 0;
}

static int
unveil(const char *path, const char *permissions)
{
	(void)path;
	(void)permissions;
	return 0;
}
#endif

/* What programs in the box may do; see the comment at the top. */
#define BOX_PROMISES \
	"stdio rpath wpath cpath dpath fattr chown flock unix dns inet " \
	"tty proc exec getpw ps vminfo sendfd recvfd prot_exec error"

#define MAXGRANTS	120	/* the kernel keeps at most 128 per process */
#define MAXARGS		32	/* words in one relay request */
#define MAXREQ		1024	/* bytes in one request, newline included */
#define MAXANSWER	(16 * 1024 * 1024)	/* bytes of answer the client keeps */
#ifndef DOAS
#define DOAS		"/usr/bin/doas"	/* cc -DDOAS='"..."' for a test */
#endif

struct grant {
	const char	*perms;
	const char	*path;
};

static struct grant	grants[MAXGRANTS];
static int		ngrants;

static void	addgrant(char *);
static void	client(const char *, int, char **);
static void	writepid(const char *);
static void	relay(const char *);
static void	serve(int, int);
static void	usage(void);

int
main(int argc, char *argv[])
{
	const char *pidfile = NULL, *sock = NULL, *csock = NULL;
	int ch, i;

	/*
	 * Before anything else: only what any mode needs.  In the box (the
	 * client) the kernel keeps only what the box's execpromises hold;
	 * "error" there makes asking for more succeed without granting it.
	 */
	if (pledge("stdio rpath wpath cpath unix proc exec unveil", NULL) == -1)
		err(1, "pledge");

	while ((ch = getopt(argc, argv, "C:D:p:u:")) != -1) {
		switch (ch) {
		case 'C':
			csock = optarg;
			break;
		case 'D':
			sock = optarg;
			break;
		case 'p':
			pidfile = optarg;
			break;
		case 'u':
			addgrant(optarg);
			break;
		default:
			usage();
		}
	}
	argc -= optind;
	argv += optind;

	if (csock != NULL) {
		if (argc == 0 || sock != NULL || ngrants != 0 || pidfile != NULL)
			usage();
		client(csock, argc, argv);
		/* NOTREACHED */
	}
	if (sock != NULL) {
		if (argc != 0 || ngrants != 0 || pidfile != NULL)
			usage();
		relay(sock);
		/* NOTREACHED */
	}
	if (argc == 0)
		usage();

	/*
	 * The pid is written before the box closes, because the pid file
	 * lives outside it.  execvp keeps the pid, so this is also the pid
	 * of the program that runs in the box.
	 */
	if (pidfile != NULL)
		writepid(pidfile);

	for (i = 0; i < ngrants; i++)
		if (unveil(grants[i].path, grants[i].perms) == -1)
			err(1, "unveil %s", grants[i].path);
	if (unveil(NULL, NULL) == -1)
		err(1, "unveil lock");

	if (pledge("stdio exec", BOX_PROMISES) == -1)
		err(1, "pledge");

	execvp(argv[0], argv);
	err(127, "%s", argv[0]);
}

/* addgrant: parse "perms:path", for example "rwc:/home/you/letters". */
static void
addgrant(char *arg)
{
	char *path;

	if ((path = strchr(arg, ':')) == NULL)
		errx(1, "%s: want perms:path", arg);
	*path++ = '\0';
	if (strspn(arg, "rwxc") != strlen(arg))
		errx(1, "%s: perms are made of r, w, x and c", arg);
	if (*path != '/')
		errx(1, "%s: path must be absolute", path);
	if (ngrants == MAXGRANTS)
		errx(1, "more than %d paths", MAXGRANTS);
	grants[ngrants].perms = arg;
	grants[ngrants].path = path;
	ngrants++;
}

/*
 * client: send "word word ...\n" to the relay at path, copy its answer
 * to standard output without the last line "cdxb: exit N", and exit N.
 * Words the relay would split or cut (blanks, a newline, or an empty
 * word) are refused, so the request is exactly the words given.
 */
static void
client(const char *path, int argc, char **argv)
{
	struct sockaddr_un sun;
	char req[MAXREQ], *ans, *last, *end;
	size_t len = 0, alen = 0, asize = 0;
	ssize_t n;
	long code;
	int s, i;

	if (pledge("stdio unix", NULL) == -1)
		err(1, "pledge");
	if (argc > MAXARGS)
		errx(1, "more than %d words", MAXARGS);
	for (i = 0; i < argc; i++) {
		if (argv[i][0] == '\0' || strpbrk(argv[i], " \t\n") != NULL)
			errx(1, "\"%s\": a word may not be empty or hold a blank "
			    "or a newline", argv[i]);
		n = snprintf(req + len, sizeof(req) - len, "%s%s",
		    i ? " " : "", argv[i]);
		if (n < 0 || (size_t)n >= sizeof(req) - len - 1)
			errx(1, "request longer than %d bytes", MAXREQ - 1);
		len += n;
	}
	req[len++] = '\n';

	memset(&sun, 0, sizeof(sun));
	sun.sun_family = AF_UNIX;
	if ((size_t)snprintf(sun.sun_path, sizeof(sun.sun_path), "%s",
	    path) >= sizeof(sun.sun_path))
		errx(1, "%s: path too long", path);
	if ((s = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0)) == -1)
		err(1, "socket");
	if (connect(s, (struct sockaddr *)&sun, sizeof(sun)) == -1)
		err(1, "the relay did not answer: %s", path);
	if (pledge("stdio", NULL) == -1)
		err(1, "pledge");

	for (i = 0; (size_t)i < len; i += n)
		if ((n = write(s, req + i, len - i)) == -1) {
			if (errno == EINTR) {
				n = 0;
				continue;
			}
			err(1, "write to the relay");
		}
	shutdown(s, SHUT_WR);

	/* Keep the whole answer: the status is its last line. */
	ans = NULL;
	for (;;) {
		if (alen == asize) {
			if (asize == MAXANSWER)
				errx(1, "answer longer than %d bytes", MAXANSWER);
			asize = asize ? asize * 2 : 8192;
			if (asize > MAXANSWER)
				asize = MAXANSWER;
			if ((ans = realloc(ans, asize + 1)) == NULL)
				err(1, NULL);
		}
		if ((n = read(s, ans + alen, asize - alen)) == -1) {
			if (errno == EINTR)
				continue;
			err(1, "read from the relay");
		}
		if (n == 0)
			break;
		alen += n;
	}
	close(s);
	if (ans == NULL || alen == 0)
		errx(1, "the relay did not answer");
	ans[alen] = '\0';

	/* The last line must be "cdxb: exit N", N a number up to 255. */
	end = ans + alen;
	if (end[-1] == '\n')
		end--;
	for (last = end; last > ans && last[-1] != '\n'; last--)
		;
	code = -1;
	if (end - last > 11 && end - last < 15 &&
	    strncmp(last, "cdxb: exit ", 11) == 0) {
		for (code = 0, i = 11; last + i < end; i++) {
			if (last[i] < '0' || last[i] > '9') {
				code = -1;
				break;
			}
			code = code * 10 + (last[i] - '0');
		}
	}
	if (code < 0 || code > 255) {
		fwrite(ans, 1, alen, stdout);
		errx(1, "no exit status from the relay");
	}
	if (fwrite(ans, 1, last - ans, stdout) != (size_t)(last - ans) ||
	    fflush(stdout) == EOF)
		err(1, "stdout");
	exit((int)code);
}

static void
writepid(const char *pidfile)
{
	int fd;

	/* O_NOFOLLOW: never write through a symbolic link planted there. */
	fd = open(pidfile, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0600);
	if (fd == -1)
		err(1, "%s", pidfile);
	if (dprintf(fd, "%ld\n", (long)getpid()) < 0)
		err(1, "%s", pidfile);
	close(fd);
}

/* relay: serve doas -n requests on a unix socket, one at a time. */
static void
relay(const char *path)
{
	struct sockaddr_un sun;
	int s, c, devnull;

	memset(&sun, 0, sizeof(sun));
	sun.sun_family = AF_UNIX;
	if ((size_t)snprintf(sun.sun_path, sizeof(sun.sun_path), "%s",
	    path) >= sizeof(sun.sun_path))
		errx(1, "%s: path too long", path);

	/* The relay needs only its socket, doas and /dev/null. */
	if (unveil(path, "rwc") == -1)
		err(1, "unveil %s", path);
	if (unveil(DOAS, "x") == -1)
		err(1, "unveil %s", DOAS);
	if (unveil("/dev/null", "rw") == -1)
		err(1, "unveil /dev/null");
	if (unveil(NULL, NULL) == -1)
		err(1, "unveil lock");

	/* CLOEXEC: neither descriptor should leak into doas. */
	if ((devnull = open("/dev/null", O_RDWR | O_CLOEXEC)) == -1)
		err(1, "/dev/null");
	if ((s = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0)) == -1)
		err(1, "socket");
	(void)unlink(path);
	if (bind(s, (struct sockaddr *)&sun, sizeof(sun)) == -1)
		err(1, "bind %s", path);
	if (listen(s, 1) == -1)
		err(1, "listen");

	/*
	 * No execpromises here, on purpose: doas is setuid, and the kernel
	 * refuses a setuid program to a process that has them.
	 */
	if (pledge("stdio unix proc exec", NULL) == -1)
		err(1, "pledge");

	/* A client that hangs up early must not kill the relay. */
	signal(SIGPIPE, SIG_IGN);

	for (;;) {
		if ((c = accept(s, NULL, NULL)) == -1) {
			if (errno == EINTR || errno == ECONNABORTED)
				continue;
			err(1, "accept");
		}
		serve(c, devnull);
		close(c);
	}
}

/* serve: read one request line from c, run doas -n, report the result. */
static void
serve(int c, int devnull)
{
	char buf[1024], *av[MAXARGS + 4], *w;
	size_t len = 0;
	ssize_t n;
	pid_t pid;
	int ac = 0, status, code;

	/* Read until a newline, end of input or a full buffer. */
	while (len < sizeof(buf) - 1) {
		if ((n = read(c, buf + len, sizeof(buf) - 1 - len)) == -1) {
			if (errno == EINTR)
				continue;
			return;
		}
		if (n == 0)
			break;
		len += n;
		if (memchr(buf, '\n', len) != NULL)
			break;
	}
	buf[len] = '\0';
	buf[strcspn(buf, "\n")] = '\0';

	/* Words split on blanks; no quoting, no globbing, no shell. */
	av[ac++] = "doas";
	av[ac++] = "-n";
	av[ac++] = "--";
	for (w = strtok(buf, " \t"); w != NULL; w = strtok(NULL, " \t")) {
		if (ac == MAXARGS + 3) {
			dprintf(c, "cdxb: too many words\ncdxb: exit 1\n");
			return;
		}
		av[ac++] = w;
	}
	av[ac] = NULL;
	if (ac == 3) {
		dprintf(c, "cdxb: empty request\ncdxb: exit 1\n");
		return;
	}

	switch (pid = fork()) {
	case -1:
		dprintf(c, "cdxb: fork: %s\ncdxb: exit 1\n", strerror(errno));
		return;
	case 0:
		/* Input from /dev/null; output and errors to the client. */
		signal(SIGPIPE, SIG_DFL);	/* an ignored signal survives exec */
		if (dup2(devnull, 0) == -1 || dup2(c, 1) == -1 ||
		    dup2(c, 2) == -1)
			_exit(127);
		execv(DOAS, av);
		dprintf(2, "cdxb: %s: %s\n", DOAS, strerror(errno));
		_exit(127);
	}
	while (waitpid(pid, &status, 0) == -1)
		if (errno != EINTR)
			return;
	if (WIFEXITED(status))
		code = WEXITSTATUS(status);
	else
		code = 128 + WTERMSIG(status);
	dprintf(c, "cdxb: exit %d\n", code);
}

static void
usage(void)
{
	fprintf(stderr, "usage: codex-box [-p pidfile] [-u perms:path ...] "
	    "program [arg ...]\n"
	    "       codex-box -D socket\n"
	    "       codex-box -C socket word ...\n");
	exit(1);
}
