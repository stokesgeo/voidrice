/*
 * @NAME@: say in one line what this program does.
 *
 * The layout follows style(9), the style of all OpenBSD C code: read
 * `man style` next to this file. /usr/src/bin/cat/cat.c has the same
 * shape; more in ~/.local/share/vertrice/learn/reading.
 */

/*
 * Includes: <sys/...> headers first, then the others in alphabetical
 * order, then your own in "quotes". Each one is here for a reason:
 * err.h for err(3), stdio.h for fprintf(3), stdlib.h for exit(3),
 * unistd.h for getopt(3) and pledge(2). Remove one and read the error.
 */
#include <err.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

/*
 * Off the machine only. pledge(2), getprogname(3) and __dead are
 * OpenBSD's; these stand-ins let other systems check this file's syntax.
 * On OpenBSD the block is skipped and the real ones are used.
 */
#ifndef __OpenBSD__
#define __dead		__attribute__((__noreturn__))
#define pledge(p, e)	0
#define getprogname()	"@NAME@"
#endif

/*
 * A function used only in this file is static, and declared before it is
 * used. __dead tells the compiler that usage() never returns, so it does
 * not warn about paths that seem to fall off the end.
 */
static void __dead	usage(void);

/*
 * The return type goes on its own line, so `grep '^main'` finds the
 * definition. argc counts the words on the command line; argv holds them,
 * argv[0] being the program's name.
 */
int
main(int argc, char *argv[])
{
	int ch;

	/*
	 * pledge(2): from here on the program promises to use only the
	 * system calls in these groups ("stdio": reading and writing open
	 * files, memory). Breaking the promise kills it with SIGABRT: a
	 * bug becomes a crash instead of a hole. Promise as little as the
	 * program needs; pledge again later to drop more. unveil(2) does
	 * the same for the file system. The list of groups is in pledge(2).
	 */
	if (pledge("stdio", NULL) == -1)
		err(1, "pledge");

	/*
	 * getopt(3) reads the options one letter at a time. The string
	 * names the letters; a colon after a letter means it takes an
	 * argument (in optarg). It is empty now: add letters and a case
	 * for each. Anything unknown ends in usage().
	 */
	while ((ch = getopt(argc, argv, "")) != -1) {
		switch (ch) {
		default:
			usage();
		}
	}
	/* Skip past the options: argv[0] is now the first operand. */
	argc -= optind;
	argv += optind;

	/*
	 * Your program goes here. For errors, use err(3) and its family:
	 * err() exits and adds strerror(errno), errx() exits without it,
	 * warn() and warnx() only print. "Don't roll your own" (style(9)).
	 */

	return 0;
}

/*
 * The usage line has the same form as the SYNOPSIS of the manual page:
 * options without arguments first, in one set of brackets, then the
 * others. Exit status 1: the caller made an error.
 */
static void __dead
usage(void)
{
	fprintf(stderr, "usage: %s\n", getprogname());
	exit(1);
}
