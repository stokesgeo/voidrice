/*
 * codex-box: the box cdxb(1) runs Codex in, and its doas relay.
 *	codex-box [-u perms:path ...] program [arg ...]	run program in the box
 *	codex-box -D socket	relay: run "doas -n -- words" for each request
 *	codex-box -C socket word ...	client, in the box: nc -U calls unveil
 * The box unveils each path, locks the list and sets execpromises: only
 * then does the kernel keep the list across execve, and fork copies both,
 * so all that Codex runs stays in the box, and no setuid program can run.
 * The relay, outside the box, answers with the output and "cdxb: exit N".
 */

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

/* Wide on purpose: "error" fails a forbidden call instead of killing. */
#define PROMISES "stdio rpath wpath cpath dpath fattr chown flock unix dns " \
	"inet tty proc exec getpw ps vminfo sendfd recvfd prot_exec error"
#define MAXGRANTS	120	/* the kernel keeps 128 */
#define MAXWORDS	32
#ifndef DOAS
#define DOAS		"/usr/bin/doas"
#endif

static void	client(const char *, char **);
static void	relay(const char *);
static void	serve(int, int);
static struct sockaddr_un sockaddr(const char *);
static void	usage(void);

int
main(int argc, char *argv[])
{
	const char *csock = NULL, *dsock = NULL;
	char *grant[MAXGRANTS], *path;
	int ch, i, n = 0;

	if (pledge("stdio rpath wpath cpath unix proc exec unveil", NULL) == -1)
		err(1, "pledge");
	while ((ch = getopt(argc, argv, "C:D:u:")) != -1) {
		switch (ch) {
		case 'C':
			csock = optarg;
			break;
		case 'D':
			dsock = optarg;
			break;
		case 'u':
			if (n == MAXGRANTS)
				errx(1, "more than %d paths", MAXGRANTS);
			grant[n++] = optarg;
			break;
		default:
			usage();
		}
	}
	argc -= optind;
	argv += optind;
	if (csock != NULL && dsock == NULL && n == 0 && argc > 0)
		client(csock, argv);
	if (dsock != NULL && csock == NULL && n == 0 && argc == 0)
		relay(dsock);
	if (csock != NULL || dsock != NULL || argc == 0)
		usage();

	for (i = 0; i < n; i++) {
		if ((path = strchr(grant[i], ':')) == NULL || path[1] != '/')
			errx(1, "%s: want perms:/path", grant[i]);
		*path++ = '\0';
		if (unveil(path, grant[i]) == -1)
			err(1, "unveil %s", path);
	}
	if (unveil(NULL, NULL) == -1)
		err(1, "unveil");
	if (pledge("stdio exec", PROMISES) == -1)
		err(1, "pledge");
	execvp(argv[0], argv);
	err(127, "%s", argv[0]);
}

/* client: send the words as one line; print the answer, exit with its N. */
static void
client(const char *path, char **argv)
{
	struct sockaddr_un sun = sockaddr(path);
	FILE *f;
	char *line = NULL, *last = NULL, *p, *q;
	size_t size = 0, lastsize = 0, t;
	ssize_t len, lastlen = 0;
	int s, i;

	if ((s = socket(AF_UNIX, SOCK_STREAM, 0)) == -1)
		err(1, "socket");
	if (connect(s, (struct sockaddr *)&sun, sizeof(sun)) == -1)
		err(1, "the relay did not answer: %s", path);
	if (pledge("stdio", NULL) == -1)
		err(1, "pledge");
	for (i = 0; argv[i] != NULL; i++) {
		if (*argv[i] == '\0' || strpbrk(argv[i], " \t\n") != NULL)
			errx(1, "\"%s\": a word may not be empty or hold a blank",
			    argv[i]);
		dprintf(s, "%s%s", i ? " " : "", argv[i]);
	}
	dprintf(s, "\n");
	shutdown(s, SHUT_WR);

	/* Print each line once the next one comes: the last is the status. */
	if ((f = fdopen(s, "r")) == NULL)
		err(1, "fdopen");
	while ((len = getline(&line, &size, f)) != -1) {
		if (lastlen > 0)
			fwrite(last, 1, lastlen, stdout);
		p = last, last = line, line = p;
		t = lastsize, lastsize = size, size = t;
		lastlen = len;
	}
	for (p = NULL, q = last; q != NULL &&
	    (q = strstr(q, "cdxb: exit ")) != NULL; p = q++)
		;
	if (p == NULL)
		errx(1, "no exit status from the relay");
	fwrite(last, 1, p - last, stdout);
	if (fflush(stdout) == EOF)
		err(1, "stdout");
	exit(atoi(p + 11));
}

/* relay: serve doas -n requests on a unix socket, one at a time. */
static void
relay(const char *path)
{
	struct sockaddr_un sun = sockaddr(path);
	int s, c, null;

	if (unveil(path, "rwc") == -1 || unveil(DOAS, "x") == -1 ||
	    unveil("/dev/null", "rw") == -1 || unveil(NULL, NULL) == -1)
		err(1, "unveil");
	if ((null = open("/dev/null", O_RDWR | O_CLOEXEC)) == -1)
		err(1, "/dev/null");
	if ((s = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0)) == -1)
		err(1, "socket");
	unlink(path);
	if (bind(s, (struct sockaddr *)&sun, sizeof(sun)) == -1 ||
	    listen(s, 1) == -1)
		err(1, "%s", path);
	/* No execpromises: the kernel refuses setuid doas under them. */
	if (pledge("stdio unix proc exec", NULL) == -1)
		err(1, "pledge");
	signal(SIGPIPE, SIG_IGN);	/* a client may hang up early */
	for (;;) {
		if ((c = accept4(s, NULL, NULL, SOCK_CLOEXEC)) == -1) {
			if (errno == ECONNABORTED)
				continue;
			err(1, "accept");
		}
		serve(c, null);
		close(c);
	}
}

/* serve: read one line of words from c, run doas -n on them, report. */
static void
serve(int c, int null)
{
	char buf[1024], *av[MAXWORDS + 4], *w;
	size_t len = 0;
	ssize_t n;
	pid_t pid;
	int ac = 0, st;

	while (len < sizeof(buf) - 1 && memchr(buf, '\n', len) == NULL &&
	    (n = read(c, buf + len, sizeof(buf) - 1 - len)) > 0)
		len += n;
	if ((w = memchr(buf, '\n', len)) == NULL) {
		dprintf(c, "cdxb: want one line under %zu bytes\ncdxb: exit 1\n",
		    sizeof(buf));
		return;
	}
	*w = '\0';
	av[ac++] = "doas";
	av[ac++] = "-n";
	av[ac++] = "--";
	for (w = strtok(buf, " \t"); w != NULL; w = strtok(NULL, " \t")) {
		if (ac == MAXWORDS + 3) {
			dprintf(c, "cdxb: more than %d words\ncdxb: exit 1\n",
			    MAXWORDS);
			return;
		}
		av[ac++] = w;
	}
	av[ac] = NULL;
	if (ac == 3) {
		dprintf(c, "cdxb: no command\ncdxb: exit 1\n");
		return;
	}
	switch (pid = fork()) {
	case -1:
		dprintf(c, "cdxb: fork: %s\ncdxb: exit 1\n", strerror(errno));
		return;
	case 0:
		signal(SIGPIPE, SIG_DFL);	/* an ignored signal survives exec */
		if (dup2(null, 0) == -1 || dup2(c, 1) == -1 || dup2(c, 2) == -1)
			_exit(127);
		execv(DOAS, av);
		dprintf(2, "cdxb: %s: %s\n", DOAS, strerror(errno));
		_exit(127);
	}
	if (waitpid(pid, &st, 0) == -1)
		return;
	dprintf(c, "cdxb: exit %d\n",
	    WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st));
}

static struct sockaddr_un
sockaddr(const char *path)
{
	struct sockaddr_un sun = { .sun_family = AF_UNIX };

	if (strlcpy(sun.sun_path, path, sizeof(sun.sun_path)) >=
	    sizeof(sun.sun_path))
		errx(1, "%s: path too long", path);
	return sun;
}

static void
usage(void)
{
	fprintf(stderr, "usage: codex-box [-u perms:path ...] program [arg ...]\n"
	    "       codex-box -D socket\n"
	    "       codex-box -C socket word ...\n");
	exit(1);
}
