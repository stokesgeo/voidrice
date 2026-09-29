# root.kshrc: a small interactive setup for root. Install as /root/.kshrc.
# `doas -s` reads it through the ENV the doas rule sets; for console root
# logins add `export ENV=/root/.kshrc` to /root/.profile (see OPENBSD.md).
#
# Root gets its own file, not the user's dotfiles: a root shell should never
# run code from a home directory the user (or anything running as the user)
# can write. Everything here is base; nothing depends on packages.

PS1='\[\e[1;31m\]\u@\h \w\[\e[0m\]# '	# red, and #: this shell is root
set -o vi
HISTFILE=/root/.ksh_history
HISTSIZE=5000

export EDITOR=vi VISUAL=vi PAGER=less	# base only: works with no packages

alias ls='ls -hF'
alias cp='cp -i' mv='mv -i' rm='rm -i'	# root has no undo
