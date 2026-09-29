-- mpvSockets, one socket per instance, removes socket on exit
--
-- Source: https://github.com/wis/mpvSockets, commit be9b7ca8 (the commit
-- voidrice's submodule pinned), MIT License, notice below. voidrice loaded
-- it as a git submodule, which a bare clone of the dotfiles never checks
-- out; vertrice keeps the one file here instead, and mpv loads it from
-- scripts/ by itself.
--
-- Changed for vertrice: the sockets live in
-- ${XDG_CACHE_HOME:-$HOME/.cache}/mpvSockets (made mode 700) instead of
-- the system temporary directory, where on OpenBSD anyone could plant a
-- file or directory of that name first. The directory is made without a
-- shell. pauseallmpv reads the same directory.
--
-- MIT License
--
-- Copyright (c) 2019 Wis
--
-- Permission is hereby granted, free of charge, to any person obtaining a copy
-- of this software and associated documentation files (the "Software"), to deal
-- in the Software without restriction, including without limitation the rights
-- to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
-- copies of the Software, and to permit persons to whom the Software is
-- furnished to do so, subject to the following conditions:
--
-- The above copyright notice and this permission notice shall be included in all
-- copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
-- SOFTWARE.

local utils = require 'mp.utils'

local cache = os.getenv("XDG_CACHE_HOME")
if cache == nil or cache == "" then
    cache = utils.join_path(os.getenv("HOME") or "", ".cache")
end
local dir = utils.join_path(cache, "mpvSockets")

mp.command_native({
    name = "subprocess",
    args = {"mkdir", "-p", "-m", "700", dir},
    playback_only = false,
    capture_stderr = true,
})

local socket = utils.join_path(dir, tostring(utils.getpid()))
mp.set_property("options/input-ipc-server", socket)

mp.register_event("shutdown", function()
    os.remove(socket)
end)
