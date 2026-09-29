# /root/.kshrc, for doas -s: vi editing as in your shell, and a red prompt that says root.
set -o vi
PS1='\[\e[1;31m\]\h:\w#\[\e[0m\] '
