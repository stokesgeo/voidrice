/*
 * proc-cwd: print the working directory of a process, for sd(1).
 *	proc-cwd pid
 * OpenBSD has no /proc: the kernel gives the directory through sysctl(2),
 * kern.proc_cwd.PID, for your own processes only (root: any).
 */

#include <sys/types.h>
#include <sys/sysctl.h>

#include <err.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static void	usage(void);

int
main(int argc, char *argv[])
{
	int mib[3] = { CTL_KERN, KERN_PROC_CWD, 0 };
	char path[PATH_MAX];
	size_t len = sizeof(path);
	const char *errstr;

	/* Nothing is opened: no path at all, and only the ps sysctls. */
	if (unveil(NULL, NULL) == -1)
		err(1, "unveil");
	if (pledge("stdio ps", NULL) == -1)
		err(1, "pledge");
	if (argc != 2)
		usage();
	mib[2] = strtonum(argv[1], 1, INT_MAX, &errstr);
	if (errstr != NULL)
		errx(1, "pid %s: %s", argv[1], errstr);
	if (sysctl(mib, 3, path, &len, NULL, 0) == -1)
		err(1, "%s", argv[1]);
	if (puts(path) == EOF)
		err(1, "stdout");
	return 0;
}

static void
usage(void)
{
	fprintf(stderr, "usage: proc-cwd pid\n");
	exit(1);
}
