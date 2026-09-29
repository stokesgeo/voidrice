# Makefile for @NAME@, using the base system's own make rules: the same
# ones every program in /usr/src is built with. Read them in
# /usr/share/mk/bsd.prog.mk and bsd.README (make(1) is BSD make, not GNU).
#
#	make		build @NAME@ here (or in ./obj, if that exists)
#	make manlint	check the manual page with mandoc -Tlint
#	make clean	remove what make built
#
# Do not run `make install` for practice programs: it copies into /usr/bin.

# The program to build. bsd.prog.mk would guess SRCS=@NAME@.c and
# MAN=@NAME@.1 from this name; SRCS is set below because the source is
# called main.c.
PROG=	@NAME@

# Every .c file of the program. A second file is one more word here.
SRCS=	main.c

# The manual page. bsd.prog.mk includes bsd.man.mk for it, which is where
# the manlint target comes from. A program without a page sets NOMAN=yes
# instead, and loses manlint with it.
MAN=	@NAME@.1

# += adds to the system's CFLAGS (-O2 and friends, from
# /usr/share/mk/sys.mk) instead of replacing them. -Wall -Wextra turn on
# most warnings; treat each one as a question the compiler is asking you.
# Two more knobs, set here or on the command line (make DEBUG=-g):
# WARNINGS=yes adds the base system's own warning set (CDIAGFLAGS in
# bsd.own.mk), and DEBUG=-g adds symbols for a debugger.
CFLAGS+=	-Wall -Wextra

# Last, always: the rules that turn the variables above into targets.
.include <bsd.prog.mk>
