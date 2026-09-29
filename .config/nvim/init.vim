let mapleader =","

if ! filereadable(system('echo -n "${XDG_CONFIG_HOME:-$HOME/.config}/nvim/autoload/plug.vim"'))
	echo "Downloading junegunn/vim-plug to manage plugins..."
	silent !mkdir -p ${XDG_CONFIG_HOME:-$HOME/.config}/nvim/autoload/
	silent !ftp -MV -o ${XDG_CONFIG_HOME:-$HOME/.config}/nvim/autoload/plug.vim "https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim"
	autocmd VimEnter * PlugInstall
endif

map ,, :keepp /<++><CR>ca<
imap ,, <esc>:keepp /<++><CR>ca<

call plug#begin(system('echo -n "${XDG_CONFIG_HOME:-$HOME/.config}/nvim/plugged"'))
Plug 'tpope/vim-surround'
Plug 'preservim/nerdtree'
Plug 'junegunn/goyo.vim'
Plug 'jreybert/vimagit'
Plug 'vimwiki/vimwiki'
Plug 'vim-airline/vim-airline'
Plug 'tpope/vim-commentary'
Plug 'ap/vim-css-color'
call plug#end()

set notermguicolors
set title
set bg=light
set mouse=a
set nohlsearch
set clipboard+=unnamedplus
set noshowmode
set noruler
set laststatus=0
set noshowcmd
colorscheme vim

" Some basics:
	nnoremap c "_c
	filetype plugin on
	syntax on
	set encoding=utf-8
	set number relativenumber
" Command-line completion: longest match, then a list, then cycle:
	set wildmode=longest,list,full
" Disables automatic commenting on newline:
	autocmd FileType * setlocal formatoptions-=c formatoptions-=r formatoptions-=o
" Perform dot commands over visual blocks:
	vnoremap . :normal .<CR>
" Goyo plugin makes text more readable when writing prose:
	map <leader>f :Goyo \| set bg=light \| set linebreak<CR>
" Prose in ~/writing: soft-wrapped at word ends, no line numbers:
	autocmd BufRead,BufNewFile ~/writing/*.md,~/writing/*.txt setlocal wrap linebreak nonumber norelativenumber textwidth=0 nospell
" K on a word in prose: its definitions and Roget headings, from dictd (vertrice-dict):
	autocmd FileType markdown,text setlocal keywordprg=dict
" Spell-check set to <leader>o, 'o' for 'orthography':
	map <leader>o :setlocal spell! spelllang=en_us<CR>
" New splits open below and to the right, where the eye expects them:
	set splitbelow splitright

" NERDTree: <leader>n toggles it. Vim quits when it is the last window left.
	map <leader>n :NERDTreeToggle<CR>
	autocmd bufenter * if (winnr("$") == 1 && exists("b:NERDTree") && b:NERDTree.isTabTree()) | q | endif
	let NERDTreeBookmarksFile = stdpath('data') . '/NERDTreeBookmarks'

" vim-airline
	if !exists('g:airline_symbols')
		let g:airline_symbols = {}
	endif
	let g:airline_symbols.colnr = ' C:'
	let g:airline_symbols.linenr = ' L:'
	let g:airline_symbols.maxlinenr = '☰ '

" Move between splits with Ctrl-h, j, k, l:
	map <C-h> <C-w>h
	map <C-j> <C-w>j
	map <C-k> <C-w>k
	map <C-l> <C-w>l

" Q reformats text (gq) in place of ex mode:
	map Q gq

" Lint the file with shellcheck:
	map <leader>s :!clear && shellcheck -x %<CR>

" Open the bibliography ($BIB) or the refer database ($REFER) in a split:
	map <leader>b :vsp<space>$BIB<CR>
	map <leader>r :vsp<space>$REFER<CR>

" S starts a substitute over the whole file:
	nnoremap S :%s//g<Left><Left>

" Compile document, be it groff/LaTeX/markdown/etc.
	map <leader>c :w! \| !compiler "%:p"<CR>

" Open corresponding .pdf/.html or preview
	map <leader>p :!opout "%:p"<CR>

" Delete LaTeX build files when leaving a .tex file:
	autocmd VimLeave *.tex !latexmk -c %

" Filetype and vimwiki setup (notes are markdown, man/ms/me/mom are groff):
	let g:vimwiki_ext2syntax = {'.Rmd': 'markdown', '.rmd': 'markdown','.md': 'markdown', '.markdown': 'markdown', '.mdown': 'markdown'}
	map <leader>v :VimwikiIndex<CR>
	let g:vimwiki_list = [{'path': '~/.local/share/nvim/vimwiki', 'syntax': 'markdown', 'ext': '.md'}]
	autocmd BufRead,BufNewFile /tmp/calcurse*,~/.calcurse/notes/* set filetype=markdown
	autocmd BufRead,BufNewFile *.ms,*.me,*.mom,*.man set filetype=groff
	autocmd BufRead,BufNewFile *.tex set filetype=tex

" No w!!: doas cannot ask for a password inside nvim. Use `doas vi file`.

" Mail written in neomutt opens in Goyo at 80 columns. ZZ and ZQ close Goyo first:
	autocmd BufRead,BufNewFile /tmp/neomutt* :Goyo 80 | call feedkeys("jk")
	autocmd BufRead,BufNewFile /tmp/neomutt* map ZZ :Goyo!\|x!<CR>
	autocmd BufRead,BufNewFile /tmp/neomutt* map ZQ :Goyo!\|q!<CR>

" On save: strip trailing whitespace and extra blank lines at end of file, then put the cursor back:
 	autocmd BufWritePre * let currPos = getpos(".")
	autocmd BufWritePre * %s/\s\+$//e
	autocmd BufWritePre * %s/\n\+\%$//e
  autocmd BufWritePre *.[ch] %s/\%$/\r/e " add trailing newline for ANSI C standard
  autocmd BufWritePre *neomutt* %s/^--$/-- /e " dash-dash-space signature delimiter in emails
  	autocmd BufWritePre * cal cursor(currPos[1], currPos[2])

" When bm-files or bm-dirs is saved, regenerate the shortcut files (see the shortcuts script):
	autocmd BufWritePost bm-files,bm-dirs !shortcuts
" Load X resources with xrdb(1) on save:
	autocmd BufRead,BufNewFile Xresources,Xdefaults,xresources,xdefaults set filetype=xdefaults
	autocmd BufWritePost Xresources,Xdefaults,xresources,xdefaults !xrdb %

" In diff mode, mark the changed text inside a changed line with MatchParen, so it stays readable:
if &diff
    highlight! link DiffText MatchParen
endif

" <leader>h hides or shows the status line, mode, ruler and command echo:
let s:hidden_all = 0
function! ToggleHiddenAll()
    if s:hidden_all  == 0
        let s:hidden_all = 1
        set noshowmode
        set noruler
        set laststatus=0
        set noshowcmd
    else
        let s:hidden_all = 0
        set showmode
        set ruler
        set laststatus=2
        set showcmd
    endif
endfunction
nnoremap <leader>h :call ToggleHiddenAll()<CR>
" Command-line shortcuts that the shortcuts script generates from bm-dirs and bm-files.
" Their prefix is ";". Typed fast, ":vs ;cfx" expands to
" ":vs /home/<user>/.config/x11/xresources".
silent! source ${XDG_CONFIG_HOME:-$HOME/.config}/nvim/shortcuts.vim
