# Git boundaries

Inspect the current repository, branch, remotes and local changes before Git
operations. Preserve unrelated edits. Do not force-push or discard changes
without explicit authorization.

The dotfiles use a bare Git repository with HOME as their work tree. This is
separate from an application's own repository. A local save, commit and remote
arrival are different outcomes; verify the requested delivery boundary.

The task tools do not initialize repositories, synchronize devices, store Git
credentials or publish records. Do not commit private task or account files
merely because they live under a directory containing a repository.
