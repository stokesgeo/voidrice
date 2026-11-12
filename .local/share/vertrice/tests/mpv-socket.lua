-- Execute the real socket setup with subprocess/property stand-ins only.
package.preload["mp.utils"] = function()
    return { join_path = function(a, b) return a .. "/" .. b end,
        getpid = function() return 42 end }
end
local source = os.getenv("VTC_REPO") .. "/.config/mpv/scripts/mpvSockets.lua"
for _, failure in ipairs({ "mkdir", "chmod", "none" }) do
    local calls, opened, cleanup, errors = {}, false, false, 0
    _G.mp = {
        command_native = function(request)
            local args = request.args
            calls[#calls + 1] = args[1]
            if args[1] == "chmod" then assert(args[2] == "700") end
            return { status = args[1] == failure and 1 or 0 }
        end,
        set_property = function(name)
            assert(name == "options/input-ipc-server")
            opened = true
        end,
        register_event = function(name)
            assert(name == "shutdown")
            cleanup = true
        end,
        msg = { error = function() errors = errors + 1 end },
    }
    assert(loadfile(source))()
    assert(opened == (failure == "none"))
    assert(cleanup == opened)
    assert(errors == (opened and 0 or 1))
    assert(#calls == (failure == "mkdir" and 1 or 2))
end
print("PASS mpv socket directory success and both failure paths")
