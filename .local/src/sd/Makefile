# proc-cwd: built with base make and cc, no ports. `make` leaves the
# program in this directory, where sd looks for it; sd runs make by
# itself on first use and again whenever proc-cwd.c is newer.

PROG=	proc-cwd
NOMAN=	noman
CFLAGS+=-Wall -Wextra

.include <bsd.prog.mk>
