-- An isolated IPE seat; ordinary nvim and the Mac IPE remain separate.
vim.g.mapleader = ','
vim.o.hidden = true
vim.o.autowrite = false
vim.o.autowriteall = false
vim.o.exrc = false
vim.o.modeline = false
vim.o.background = 'dark'
vim.o.termguicolors = false
vim.o.undofile = true
vim.o.swapfile = true
vim.o.fixendofline = false
require('durability').setup()
require('ipe.pi').setup()
