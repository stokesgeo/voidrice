#!/usr/local/bin/python3
"""Synthetic HOME/keyring/pass; native curl parser/bad-CA loopback and parsers.
Enrollment connections are mocked; no provider access or owner credentials.
"""
import hashlib
import json
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import tempfile
import time
import unittest

REPO = Path(__file__).resolve().parents[4]
ASSETS = REPO / '.local/share/openbsd/mail/mutt-wizard'
A = 'alice@example.invalid'
B = 'bob@example.invalid'
SECRET = '  Synthetic-MW-Canary-\\"+$!  '
MOCK = r'''#!/usr/local/bin/python3
import json, os, sys, time
from pathlib import Path
name=Path(sys.argv[0]).name; h=Path(os.environ['HOME'])
fault=os.environ.get('FAULT',''); store=Path(os.environ.get('PASSWORD_STORE_DIR',str(h/'.password-store')))
rootstore=Path(os.environ.get('FIXTURE_STORE',str(h/'.password-store')))
secret=(h/'expected-secret').read_text() if (h/'expected-secret').exists() else '  Synthetic-MW-Canary-\\"+$!  '
assert all(secret not in v for v in sys.argv+list(os.environ.values()))
with (h/'calls').open('a') as f: f.write(json.dumps([name,sys.argv[1:],str(store)])+'\n')
def once(tag):
    p=h/('once-'+tag)
    if p.exists(): return False
    p.touch(); return True
def block():
    (h/'blocked').write_text(name)
    while True: time.sleep(.05)
if name=='curl':
    assert sys.argv[1:]==['--disable','--config','-']
    cfg=sys.stdin.read()
    assert 'proto = "=imaps"' in cfg and 'max-time = 30' in cfg
    assert not any(x in cfg for x in ['insecure','location','trace','verbose'])
    assert 'connect-only' not in cfg
    assert secret.replace('\\','\\\\').replace('"','\\"') in cfg
    # The fault belongs to the actual authenticated connection, not a preflight.
    if fault=='tls': sys.exit(60)
    if fault.startswith('curl-status-'): sys.exit(int(fault.rsplit('-',1)[1]))
    if fault=='malformed-list': print('* BAD malformed fixture'); sys.exit(0)
    with (h/'auth-released').open('a') as f: f.write('synthetic authentication\n')
    if fault=='auth' or fault=='auth-once' and once('auth'): sys.exit(67)
    if fault=='external-edit': (h/'.mbsyncrc').write_text('# external edit\n')
    if fault=='mail-policy-change': (rootstore/'mail/.gpg-id').write_bytes((rootstore/'.gpg-id').read_bytes())
    if fault=='late-symlink': (h/'.mbsyncrc').symlink_to(h/'foreign')
    print('* LIST (\\HasNoChildren) "/" "INBOX"\r')
    sys.exit(0)
if name=='pass':
    assert sys.argv[1] in ['insert','show']
    record=Path(os.environ.get('XDG_CONFIG_HOME',str(h/'.config')))/'mutt/.mw-pending/record'
    assert record.is_file() and record.stat().st_mode & 0o777 == 0o600
    assert str(rootstore) in record.read_text()
    if sys.argv[1]=='insert':
        assert store!=rootstore
        policy=rootstore
        if (policy/'mail/.gpg-id').is_file() and sys.argv[-1] not in os.environ.get('ROOT_PROFILE','').split():
            policy=policy/'mail'
        assert (store/'.gpg-id').read_bytes()==(policy/'.gpg-id').read_bytes()
        if fault=='insert-block': block()
    if sys.argv[1]=='show' and fault=='readback-block': block()
    if os.environ.get('MW_TRACE_NATIVE_VERIFY'): os.environ['MW_NATIVE_PASS']='1'
    os.execv('/usr/local/bin/pass',['pass']+sys.argv[1:])
if name=='neomutt':
    if fault=='parser' or fault=='parser-once' and once('parser'): sys.exit(1)
    assert '-Q' in sys.argv
    os.execv('/usr/local/bin/neomutt',['neomutt']+sys.argv[1:])
if name in ['mbsync','msmtp']:
    assert '--list-stores' in sys.argv if name=='mbsync' else '--pretend' in sys.argv
    os.execv('/usr/local/bin/'+name,[name]+sys.argv[1:])
if name=='ln':
    src=Path(sys.argv[-2]); dst=Path(sys.argv[-1])
    assert src.stat().st_mode & 0o777 == 0o600
    if fault=='link-gap' and dst.suffix=='.gpg' or fault=='lock-link-block' and dst.name=='.mw-active':
        os.link(src,dst); block()
    if fault=='credential-collision' and dst.suffix=='.gpg': dst.write_text('foreign ciphertext'); sys.exit(1)
    os.execv('/bin/ln',['ln']+sys.argv[1:])
if name=='cp':
    dst=Path(sys.argv[-1])
    if dst.name=='.gpg-id' and fault=='init-before-record-block': block()
    if dst.name=='original-muttrc':
        if fault=='init-snapshot-block': block()
        if fault=='init-snapshot-error': sys.exit(1)
    os.execv('/bin/cp',['cp']+sys.argv[1:])
if name=='mv':
    dst=Path(sys.argv[-1])
    phase=('delete' if dst.name=='original' and dst.parent.name.startswith('.mw-remove.') else
           'account' if dst.suffix=='.muttrc' and dst.parent.name=='accounts' else
           'sync' if dst==h/'.mbsyncrc' else
           'draft' if dst==h/'.config/mutt/smtp-draft.txt' else
           'reader' if dst==h/'.config/mutt/muttrc' else '')
    if phase=='delete' and fault=='removed-account-conflict':
        source=Path(sys.argv[-2]); os.rename(source,dst)
        source.write_text('# foreign account edit after removal\n'); sys.exit(1)
    if phase and fault.startswith('lifecycle-'+phase+'-') and once(fault):
        if fault.endswith('-after-error') or fault.endswith('-block'):
            os.rename(sys.argv[-2],sys.argv[-1])
        if fault.endswith('-block'): block()
        sys.exit(1)
    pending=h/'.config/mutt/.mw-pending'
    if fault=='committed-block' and dst.name=='committed':
        os.rename(sys.argv[-2],sys.argv[-1]); block()
    if fault=='init-ready-block' and dst==pending:
        os.rename(sys.argv[-2],sys.argv[-1]); block()
    if fault=='complete-write' and dst.name=='committed':
        os.rename(sys.argv[-2],sys.argv[-1])
        (pending/'record-ready').mkdir() # actual following printf redirection fails
        sys.exit(0)
    if fault=='archive-after-commit' and dst.name.startswith('.mw-pending.complete.'):
        assert (pending/'committed').is_file()
        sys.exit(1)
    if dst==h/'.mbsyncrc':
        if fault=='sync-eacces':
            h.chmod(0o500) # native mv must fail EACCES, not a fabricated exit
        if fault=='publication-block': block()
        if fault=='write-once' and once('write'): sys.exit(1)
    if fault=='marker' and dst.name=='committed': sys.exit(1)
    if fault=='edit-published' and dst.name=='muttrc':
        (h/'.mbsyncrc').write_text('# external published edit\n'); sys.exit(1)
    os.execv('/bin/mv',['mv']+sys.argv[1:])
raise AssertionError(name)
'''


# Native fast path retains canary checks and the exact calls JSON format.
CP_MV_FRONT = r'''/* No-fault cp/mv front end. All other modes retain the Python fixture. */
#include <sys/types.h>
#include <err.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern char **environ;
static const char secret[] = "  Synthetic-MW-Canary-\\\"+$!  ";

/* Python json.dumps defaults to ensure_ascii. Delegate non-ASCII to it. */
static int
ascii(const char *s)
{
	for (; *s; s++)
		if ((unsigned char)*s >= 127)
			return 0;
	return 1;
}

/* These already-normalized absolute paths have identical pathlib spelling. */
static int
normalized(const char *s)
{
	size_t n = strlen(s);
	return n > 1 && s[0] == '/' && s[n - 1] != '/' &&
	    strstr(s, "//") == NULL && strstr(s, "/./") == NULL &&
	    strstr(s, "/../") == NULL && strcmp(s + n - 2, "/.") != 0 &&
	    !(n >= 3 && strcmp(s + n - 3, "/..") == 0) && ascii(s);
}

static void
json(FILE *f, const char *s)
{
	unsigned char c;
	fputc('"', f);
	while ((c = (unsigned char)*s++) != '\0') {
		switch (c) {
		case '"': fputs("\\\"", f); break;
		case '\\': fputs("\\\\", f); break;
		case '\b': fputs("\\b", f); break;
		case '\f': fputs("\\f", f); break;
		case '\n': fputs("\\n", f); break;
		case '\r': fputs("\\r", f); break;
		case '\t': fputs("\\t", f); break;
		default:
			if (c < 32)
				fprintf(f, "\\u%04x", c);
			else
				fputc(c, f);
		}
	}
	fputc('"', f);
}

int
main(int argc, char **argv)
{
	const char *name, *home, *store, *fault;
	char *fallback, *calls, *default_store;
	int fast = 1, i, bad;
	FILE *f;
	char **e;

	name = strrchr(argv[0], '/');
	name = name == NULL ? argv[0] : name + 1;
	if (strcmp(name, "cp") != 0 && strcmp(name, "mv") != 0)
		errx(1, "fixture helper name");
	home = getenv("HOME");
	if (home == NULL)
		errx(1, "fixture HOME missing");
	if (asprintf(&fallback, "%s/bin/%s", home, name) == -1 ||
	    asprintf(&calls, "%s/calls", home) == -1 ||
	    asprintf(&default_store, "%s/.password-store", home) == -1)
		err(1, "fixture allocation");
	store = getenv("PASSWORD_STORE_DIR");
	if (store == NULL)
		store = default_store;
	fault = getenv("FAULT");
	/* Explicit ordinary mode only; every fault takes the unchanged mock. */
	if ((fault != NULL && *fault != '\0') || !normalized(home) ||
	    !normalized(store))
		fast = 0;
	for (i = 0; i < argc; i++)
		if (!ascii(argv[i]) || strstr(argv[i], secret) != NULL)
			fast = 0;
	for (e = environ; *e != NULL; e++) {
		const char *value = strchr(*e, '=');
		if (value != NULL && strstr(value + 1, secret) != NULL)
			fast = 0;
	}
	if (!fast || (f = fopen(calls, "a")) == NULL) {
		execv(fallback, argv);
		errx(1, "fixture Python fallback exec");
	}
	/* Same record, before native work, even when the native command fails. */
	fputc('[', f); json(f, name); fputs(", [", f);
	for (i = 1; i < argc; i++) {
		if (i != 1)
			fputs(", ", f);
		json(f, argv[i]);
	}
	fputs("], ", f); json(f, store); fputs("]\n", f);
	bad = ferror(f);
	if (fclose(f) != 0 || bad)
		errx(1, "fixture call record write");
	argv[0] = (char *)name;
	execv(strcmp(name, "cp") == 0 ? "/bin/cp" : "/bin/mv", argv);
	errx(1, "fixture native exec");
}
'''


class Overlay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory(prefix='mw-delta-build-', dir=tempfile.gettempdir())
        cls.prepare_cp_mv(Path(cls.shared.name))
        cls.candidate = Path(cls.shared.name)/'mw'
        # The runner's HOME and TMPDIR are siblings. Give the source-only
        # builder its private output parent as HOME (also valid off /tmp).
        subprocess.run(['sh', str(ASSETS/'build'), str(cls.candidate)], check=True,
                       capture_output=True, env=dict(os.environ, HOME=cls.shared.name))

    @classmethod
    def prepare_cp_mv(cls, directory):
        source = directory/'cp-mv.c'
        source.write_text(CP_MV_FRONT)
        cls.cp_mv_front = directory/'cp-mv'
        subprocess.run(['cc', '-Wall', '-Wextra', '-O2', '-o', str(cls.cp_mv_front),
                        str(source)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mw-delta-', dir=tempfile.gettempdir())
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bin = self.home/'bin'; self.bin.mkdir()
        mock = self.bin/'mock'; mock.write_text(MOCK); mock.chmod(0o700)
        for name in ['curl','pass','neomutt','mbsync','msmtp','ln','mv','cp']:
            (self.bin/name).symlink_to(mock)
        fast = self.home/'fast-bin'; fast.mkdir()
        for name in ['cp', 'mv']:
            (fast/name).symlink_to(self.cp_mv_front)
        self.gpg = self.home/'gpg'; self.gpg.mkdir(mode=0o700)
        self.store = self.home/'.password-store'
        self.env = {'HOME': str(self.home), 'GNUPGHOME': str(self.gpg), 'LC_ALL':'C', 'TERM':'xterm',
                    'PATH': f'{fast}:{self.bin}:/bin:/usr/bin:/usr/local/bin',
                    'GIT_CONFIG_NOSYSTEM':'1', 'GIT_CONFIG_GLOBAL':'/dev/null'}
        self.addCleanup(lambda: subprocess.run(['gpgconf','--homedir',str(self.gpg),'--kill','gpg-agent'],
                                               env=self.env,capture_output=True))
        self.native(['gpg','--batch','--pinentry-mode','loopback','--passphrase','',
                     '--quick-generate-key','MW Synthetic <fixture@example.invalid>','ed25519','cert','0'])
        keys=self.native(['gpg','--with-colons','--list-secret-keys']).stdout
        fpr=next(x.split(':')[9] for x in keys.splitlines() if x.startswith('fpr:'))
        self.fpr=fpr
        self.native(['gpg','--batch','--pinentry-mode','loopback','--passphrase','',
                     '--quick-add-key',fpr,'cv25519','encr','0'])
        self.native(['pass','init',fpr])
        self.git('init','-q')
        for key,value in [('user.name','Synthetic'),('user.email','fixture@example.invalid'),
                          ('commit.gpgsign','false'),('gc.auto','0'),
                          ('maintenance.auto','false')]: self.git('config',key,value)
        (self.store/'foreign').write_text('baseline\n')
        self.git('add','.'); self.git('commit','-qm','synthetic baseline')
        (self.store/'foreign').write_text('staged\n'); self.git('add','foreign')
        (self.store/'foreign').write_text('unstaged\n')
        (self.store/'untracked').write_text('untracked\n')
        hook=self.store/'.git/hooks/pre-commit'
        hook.write_text('#!/bin/sh\nprintf hook > "$HOME/hook-ran"\nexit 1\n'); hook.chmod(0o700)
        self.before=self.git_snapshot()

    def native(self, args, data=None):
        p=subprocess.run(args,input=data,text=True,capture_output=True,timeout=40,
                         env=dict(self.env,PATH='/bin:/usr/bin:/usr/local/bin'))
        self.assertEqual(p.returncode,0,repr(args)+p.stderr)
        return p

    def git(self,*args):
        return self.native(['git','-C',str(self.store),*args]).stdout

    def git_snapshot(self):
        return (self.git('rev-parse','HEAD'), (self.store/'.git/index').read_bytes(),
                (self.store/'foreign').read_bytes(), (self.store/'untracked').read_bytes(),
                tuple((str(p.relative_to(self.store)),p.read_bytes()) for p in sorted((self.store/'.git').rglob('*')) if p.is_file()))

    @property
    def pending(self): return self.home/'.config/mutt/.mw-pending'

    def runmw(self,email=A,data=None,fault='',extra=None,trace=None,resume=True):
        if data is None: data='yes\n'+SECRET+'\n'
        if extra:
            for opt in ['-a','-e','-R','-D']:
                if opt in extra: email=extra[extra.index(opt)+1]; break
        args=[str(self.candidate),'--password-stdin',*(extra or ['-a',email,'-i','imap.example.invalid'])]
        if resume and (self.pending/'record').is_file():
            saved=(self.pending/'record').read_text().splitlines()
            if len(saved)>13 and saved[1]==email and not (self.pending/'committed').exists():
                data='resume\n'+data
        if trace:
            args=['/usr/bin/ktrace','-i','-t','xX','-f',str(trace),*args]
        # Own the whole fixture process group: killing only the shell on timeout
        # leaves parser/pass children racing TemporaryDirectory cleanup.
        with subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                              text=True,start_new_session=True,env=dict(self.env,FAULT=fault)) as child:
            try:
                started=time.monotonic()
                stdout,stderr=child.communicate(data,timeout=float(os.environ.get('MW_RUNMW_TIMEOUT','60')))
                if os.environ.get('MW_TIMING_LOG'):
                    with open(os.environ['MW_TIMING_LOG'],'a') as timing:
                        timing.write(json.dumps(dict(case=self.id(),seconds=time.monotonic()-started,
                            limit=float(os.environ.get('MW_RUNMW_TIMEOUT','60')),status=child.returncode))+'\n')
            except subprocess.TimeoutExpired:
                try: os.killpg(child.pid,signal.SIGTERM)
                except ProcessLookupError: pass
                try: child.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    try: os.killpg(child.pid,signal.SIGKILL)
                    except ProcessLookupError: pass
                    child.communicate()
                raise
            p=subprocess.CompletedProcess(args,child.returncode,stdout,stderr)
        self.assertNotIn(SECRET,p.stdout+p.stderr)
        self.assertEqual(self.before,self.git_snapshot())
        self.assertFalse((self.home/'hook-ran').exists())
        for f in self.home.rglob('*'):
            if f.is_file() and not f.is_symlink() and f.name!='mock' and self.gpg not in f.parents:
                self.assertNotIn(SECRET.encode(),f.read_bytes(),str(f))
        return p

    def ok(self,p): self.assertEqual(p.returncode,0,p.stdout+p.stderr)
    def failed(self,p): self.assertNotEqual(p.returncode,0,p.stdout+p.stderr)
    def read(self,rel): return (self.home/rel).read_bytes()
    def show(self,email): return self.native(['pass','show',email]).stdout

    def assert_bound_passcmd(self, config, store, ref):
        import shlex
        lines=[x for x in config.splitlines() if x.startswith('PassCmd ')]
        decoded=[shlex.split(shlex.split(x[8:])[0]) for x in lines]
        words=next((x for x in decoded if x[-2:]==[str(store),ref]),None)
        self.assertIsNotNone(words,decoded)
        self.assertEqual(words[:2],['/bin/ksh','-c'])
        self.assertIn('PASSWORD_STORE_DIR="$1" pass show "$2"',words[2])
        self.assertIn('print -rn -- "$first"',words[2])
        self.assertNotIn('printf',words[2])

    def keep_trace(self, trace, dump):
        # Optional private forensic receipts; caller chooses a fresh directory.
        # Only synthetic fixture environments/credentials ever enter these.
        root=os.environ.get('MW_CORE_EVIDENCE')
        if root:
            root=Path(root); root.mkdir(mode=0o700,parents=True,exist_ok=True)
            for name,data in [(trace.name,trace.read_bytes()),(trace.name+'.dump',dump.encode())]:
                with (root/name).open('xb') as out: out.write(data)

    def curl_config(self, port='993'):
        source=self.candidate.read_text()
        function=source[source.index('mw_curl_config() {'):].split('\n}',1)[0]+'\n}\n'
        p=subprocess.run(['/bin/ksh','-c',function+'imap=127.0.0.1; iport=$1; sslcert=/etc/ssl/cert.pem; mw_curl_config','fixture',port],
                         env=self.env,text=True,capture_output=True,check=True)
        return p.stdout

    def test_core_native_exec_observer(self):
        # OpenBSD ktrace -i inherits across ALL descendant execs; x records
        # argv and X records env. No I/O tracing or owner process attachment.
        # This is not sampling or a mock-child-only observer.
        trace=self.home/'exec.ktrace'
        self.ok(self.runmw(trace=trace))
        dump=subprocess.run(['/usr/bin/kdump','-t','xX','-f',str(trace)],
                            env=self.env,text=True,capture_output=True,check=True).stdout
        self.keep_trace(trace,dump)
        self.assertNotIn('Synthetic-MW-Canary',dump)
        self.assertIn('ARGS',dump); self.assertIn('ENV',dump)
        self.assertIn('/usr/local/bin/pass',dump); self.assertIn('gpg',dump)
        # Run the real generated nested PassCmd through native ksh/pass/GPG.
        line=next(l for l in (self.home/'.mbsyncrc').read_text().splitlines() if l.startswith('PassCmd '))
        import shlex
        command=shlex.split(line)[1]
        p=subprocess.run(['/usr/bin/ktrace','-i','-t','xX','-f',str(self.home/'passcmd.ktrace'),
                          '/bin/ksh','-c',command],env=dict(self.env,PATH='/bin:/usr/bin:/usr/local/bin'),text=True,capture_output=True,timeout=60)
        self.assertEqual(p.returncode,0,p.stderr); self.assertEqual(p.stdout,SECRET)
        nested=subprocess.run(['/usr/bin/kdump','-t','xX','-f',str(self.home/'passcmd.ktrace')],
                              env=self.env,text=True,capture_output=True,check=True).stdout
        self.keep_trace(self.home/'passcmd.ktrace',nested)
        self.assertNotIn('Synthetic-MW-Canary',nested)
        self.assertIn('gpg',nested)
        # Old external producer positive control: same known synthetic bytes,
        # input via pipe, not command/env. Observer MUST catch printf argv.
        old=self.home/'old.ktrace'
        p=subprocess.run(['/usr/bin/ktrace','-i','-t','xX','-f',str(old),'/bin/ksh','-c',
                          'unset value; IFS= read -r value; /usr/bin/printf "%s" "$value"'],
                         input=SECRET+'\n',env=self.env,text=True,capture_output=True,timeout=20)
        self.assertEqual(p.stdout,SECRET)
        dump=subprocess.run(['/usr/bin/kdump','-t','xX','-f',str(old)],env=self.env,
                            text=True,capture_output=True,check=True).stdout
        self.keep_trace(old,dump)
        self.assertIn('Synthetic-MW-Canary',dump); self.assertIn('/usr/bin/printf',dump)

    def test_core_native_tls_exec_coverage(self):
        import base64, shlex, socket, ssl, threading
        root=self.home/"private space café O'Neil"; root.mkdir(mode=0o700)
        store=root/'pass store'; store.mkdir(mode=0o700)
        (store/'.gpg-id').write_bytes((self.store/'.gpg-id').read_bytes())
        (store/'.gpg-id').chmod(0o600)
        wire_secret='-MW-Native-Canary-\\" with spaces'
        self.env.update(PASSWORD_STORE_DIR=str(store),FIXTURE_STORE=str(store),
                        XDG_CONFIG_HOME=str(root/'config'),XDG_DATA_HOME=str(root/'data'),
                        XDG_CACHE_HOME=str(root/'cache'))
        self.native(['gpg','--batch','--yes','--encrypt','-r',self.fpr,'-o',str(store/(A+'.gpg'))],
                    data=wire_secret+'\nMW-Metadata-Canary with quotes \\\"\n')
        cert=root/'localhost.pem'; key=root/'localhost.key'
        cnf=self.home/'openssl.cnf'
        cnf.write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n')
        self.native(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                     '-config',str(cnf),'-keyout',str(key),'-out',str(cert)])
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); context.load_cert_chain(cert,key)
        listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(5); listener.settimeout(.2)
        port=str(listener.getsockname()[1]); stop=threading.Event(); authenticated=[]; errors=[]; commands=[]
        def serve():
            while not stop.is_set():
                try: conn,_=listener.accept()
                except socket.timeout: continue
                except OSError: break
                try:
                    conn.settimeout(15)
                    with context.wrap_socket(conn,server_side=True) as tls:
                        f=tls.makefile('rwb',buffering=0); f.write(b'* OK synthetic IMAP\r\n')
                        while line:=f.readline():
                            parts=line.decode().rstrip('\r\n').split(' ',2)
                            tag,cmd=parts[:2]; cmd=cmd.upper(); commands.append(cmd); args=parts[2] if len(parts)>2 else ''
                            if cmd=='CAPABILITY': f.write(b'* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n')
                            elif cmd=='AUTHENTICATE':
                                a=args.split(' ',1)
                                if len(a)==1: f.write(b'+ \r\n'); payload=f.readline().strip()
                                else: payload=a[1].encode()
                                fields=base64.b64decode(payload).split(b'\0')
                                assert fields[-1]==wire_secret.encode(); authenticated.append('curl')
                            elif cmd=='LOGIN':
                                fields=shlex.split(args); assert fields[-1]==wire_secret; authenticated.append('isync')
                            elif cmd=='LIST': f.write(b'* LIST (\\HasNoChildren) "/" "INBOX"\r\n')
                            elif cmd=='NAMESPACE': f.write(b'* NAMESPACE (("" "/")) NIL NIL\r\n')
                            elif cmd=='LOGOUT': f.write(b'* BYE fixture done\r\n')
                            else: raise AssertionError('unsupported fixture command '+cmd)
                            f.write((tag+' OK fixture\r\n').encode())
                            if cmd=='LOGOUT': break
                except Exception as e:
                    # curl may close immediately after LOGOUT; authentication
                    # and LIST must already have succeeded independently.
                    if not (isinstance(e,BrokenPipeError) and commands and commands[-1]=='LOGOUT'):
                        errors.append(type(e).__name__)
                finally:
                    if 'f' in locals(): f.close()
                    conn.close()
        worker=threading.Thread(target=serve); worker.start()
        self.env.update(SSL_CERT_FILE=str(cert))
        (self.bin/'curl').unlink(); (self.bin/'curl').symlink_to('/usr/local/bin/curl')
        trace=self.home/'native-tls.ktrace'
        try:
            self.ok(self.runmw(data='yes\n',extra=['-a',A,'-i','localhost','-I',port],trace=trace))
            native_trace=self.home/'isync.ktrace'
            p=subprocess.run(['/usr/bin/ktrace','-i','-t','xX','-f',str(native_trace),
                              '/usr/local/bin/mbsync','-c',str(self.home/'.mbsyncrc'),
                              '--list-stores',A+'-remote'],env=dict(self.env,PATH='/bin:/usr/bin:/usr/local/bin'),
                             text=True,capture_output=True,timeout=60)
            self.assertEqual(p.returncode,0,p.stderr+' commands='+repr(commands)+' errors='+repr(errors))
            self.assertIn('INBOX',p.stdout)
            for path in [trace,native_trace]:
                dump=subprocess.run(['/usr/bin/kdump','-t','xX','-f',str(path)],env=self.env,
                                    text=True,capture_output=True,check=True).stdout
                self.keep_trace(path,dump)
                self.assertNotIn('Synthetic-MW-Canary',dump)
                self.assertNotIn('MW-Native-Canary',dump); self.assertNotIn('MW-Metadata-Canary',dump)
                self.assertIn('ARGS',dump); self.assertIn('ENV',dump)
            self.assertEqual(authenticated,['curl','isync']); self.assertEqual(errors,[])
            self.assertIn('CertificateFile "'+str(cert)+'"',(self.home/'.mbsyncrc').read_text())
        finally:
            stop.set(); listener.close(); worker.join(20)
        self.assertFalse(worker.is_alive())

    def test_core_cancel_does_not_block_other_account(self):
        self.ok(self.runmw(B))
        self.failed(self.runmw(data='n\n'))
        self.assertFalse(self.pending.exists())
        self.assertTrue(list(self.pending.parent.glob('.mw-pending.cancelled.'+A+'.*')))
        self.ok(self.runmw(B,data='yes\n',extra=['-R',B]))

    def test_core_empty_password_archive(self):
        self.failed(self.runmw(data='yes\n\ncancel\n'))
        self.assertFalse(self.pending.exists())
        self.assertFalse((self.store/(A+'.gpg')).exists())
        self.ok(self.runmw(B))

    def test_core_sigkill_after_atomic_lock_link(self):
        args=[str(self.candidate),'--password-stdin','-a',A,'-i','localhost']
        p=subprocess.Popen(args,env=dict(self.env,FAULT='lock-link-block'),stdin=subprocess.PIPE,
                           stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        try:
            end=time.monotonic()+60
            while not (self.home/'blocked').exists() and time.monotonic()<end: time.sleep(.02)
            self.assertTrue((self.home/'blocked').exists())
            lock=self.home/'.config/mutt/.mw-active'
            self.assertEqual(len(lock.read_text().split()),7)
            os.killpg(p.pid,signal.SIGKILL); p.communicate(timeout=10)
            self.ok(self.runmw())
            self.assertFalse(lock.exists())
        finally:
            if p.poll() is None: os.killpg(p.pid,signal.SIGKILL); p.communicate()

    def test_core_stale_and_live_writer_identity(self):
        parent=self.home/'.config/mutt'; parent.mkdir(parents=True)
        lock=parent/'.mw-active'
        identity=subprocess.run(['ps','-p',str(os.getpid()),'-o','uid=,pid=,lstart='],
                                text=True,capture_output=True,check=True).stdout
        identity=' '.join(identity.split())+'\n'
        lock.write_text(identity); lock.chmod(0o600)
        self.failed(self.runmw()); self.assertEqual(lock.read_text(),identity)
        # Existing PID is not enough: an old start identity is recoverable.
        lock.write_text(f'{os.getuid()} {os.getpid()} Mon Jan 1 00:00:00 1990\n')
        self.ok(self.runmw())
        self.assertFalse(lock.exists()); self.assertTrue(list(parent.glob('.mw-active.recovered.*')))

    def test_core_pending_other_account_leaveaside_and_resume(self):
        self.ok(self.runmw(B))
        failure=self.runmw(data='yes\n'+SECRET+'\nquit\n',fault='parser'); self.failed(failure)
        self.assertTrue((self.pending/'record').is_file(),failure.stdout+failure.stderr)
        self.assertEqual((self.pending/'record').read_text().splitlines()[10],'credential-saved')
        p=self.runmw(B,data='leaveaside\nyes\n',extra=['-R',B]); self.ok(p)
        self.assertIn('Incomplete setup for '+A,p.stdout)
        self.assertTrue(list(self.pending.parent.glob('.mw-pending.aside.'+A+'.*')))
        self.assertTrue((self.store/(A+'.gpg')).exists())
        failure=self.runmw(data='yes\nquit\n',fault='parser'); self.failed(failure)
        self.assertTrue((self.pending/'record').is_file(),failure.stdout+failure.stderr)
        p=self.runmw(B,data='resume\nresume\nyes\n',extra=['-R',B]); self.ok(p)
        self.assertIn('Incomplete setup for '+A,p.stdout)
        self.assertTrue((self.home/'.config/mutt/accounts'/(A+'.muttrc')).is_file())
        self.assertTrue((self.home/'.config/mutt/accounts'/(B+'.muttrc')).is_file())

    def test_core_policy_changed_restart_in_flow(self):
        self.failed(self.runmw(data='yes\n'+SECRET+'\nquit\n',fault='parser'))
        policy=self.store/'.gpg-id'; policy.write_text(policy.read_text()+'# revised recipients policy\n')
        p=self.runmw(data='restart\nyes\n',resume=False); self.ok(p)
        self.assertIn('Recipient policy changed',p.stdout)
        self.assertTrue(list(self.pending.parent.glob('.mw-pending.policy.'+A+'.*')))
        self.assertEqual(self.show(A),SECRET+'\n')

    def test_core_wrong_existing_password_replaced_after_verify(self):
        # Populate ordinary ciphertext directly with native GPG, no pass Git.
        self.native(['gpg','--batch','--yes','--encrypt','-r',self.fpr,'-o',str(self.store/(A+'.gpg'))],
                    data=SECRET+'\nprivate metadata old\n')
        old=(self.store/(A+'.gpg')).read_bytes()
        self.ok(self.runmw(data='yes\nreenter\nyes\n'+SECRET+'\n',fault='auth-once'))
        self.assertNotEqual(old,(self.store/(A+'.gpg')).read_bytes())
        archived=list(self.pending.parent.glob('.mw-pending.complete.'+A+'.*'))[-1]
        stage=Path((archived/'record').read_text().splitlines()[7])
        self.assertFalse(stage.exists())
        self.assertEqual(self.show(A),SECRET+'\n')

    def test_core_google_grouping_generic_spaces_and_utf8_paths(self):
        expected='abcdefghijklmnop'; (self.home/'expected-secret').write_text(expected)
        gmail='synthetic@gmail.com'
        self.ok(self.runmw(gmail,data='yes\nabcd efgh\u00a0ijkl mnop\r\n',
                           extra=['-a',gmail,'-i','imap.gmail.com']))
        self.assertEqual(self.show(gmail),expected+'\n')
        (self.home/'expected-secret').unlink()
        root=self.home/'private space café'; root.mkdir(mode=0o700)
        self.env.update(XDG_CONFIG_HOME=str(root/'config'),XDG_DATA_HOME=str(root/'data'),
                        XDG_CACHE_HOME=str(root/'cache'),MBSYNCRC=str(root/'mbsyncrc'))
        # Mock pass's journal assertion is rooted at its original HOME; use
        # the already native stored credential so no fixture insert needed.
        (self.bin/'pass').unlink(); (self.bin/'pass').symlink_to('/usr/local/bin/pass')
        self.native(['gpg','--batch','--yes','--encrypt','-r',self.fpr,'-o',str(self.store/(A+'.gpg'))],data=SECRET+'\n')
        self.ok(self.runmw())
        self.assertEqual(self.show(A),SECRET+'\n')
        self.ok(self.runmw(B))

    def test_first_inbox_selected_account_and_recovery_choices(self):
        source=self.candidate.read_text()
        function=source[source.index('mw_first_inbox()'):source.index('togglecron()',source.index('mw_first_inbox()'))]
        script='''set +axv
exec 3<&0
mw_fail() { print -r -- "$*" >&2; }
mw_prompt() { print -r -- "$1" >&2; IFS= read -r "$2" <&3; }
mw_neoq() { print -r -- "\\\"$1\\\""; }
mw_sync() { print -r -- "SYNC:$mw_syncaccount"; [ "$SYNC_OK" = yes ]; }
neomutt() { print -r -- "READER:$*"; return 0; }
fulladdr=bob@example.invalid
live_muttrc=/synthetic/muttrc
live_accdir=/synthetic/accounts
maildir=/synthetic/mail
'''+function+'\nmw_first_inbox\n'
        for success,answers,count,opens in [('yes','',1,1),('no','later\n',1,0),
                ('no','open\n',1,1),('no','invalid\nlater\n',1,0),('no','retry\nlater\n',2,0)]:
            result=subprocess.run(['/bin/ksh','-c',script],input=answers,text=True,capture_output=True,
                                  env=dict(self.env,SYNC_OK=success))
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout.count('SYNC:bob@example.invalid'),count)
            self.assertEqual(result.stdout.count('READER:'),opens)
            if opens:
                self.assertIn('/synthetic/accounts/bob@example.invalid.muttrc',result.stdout)
                self.assertIn('-f /synthetic/mail/bob@example.invalid/INBOX',result.stdout)

    def test_sync_binds_reviewed_live_configuration(self):
        source=self.candidate.read_text()
        function=source[source.index('mw_sync()'):source.index('mw_first_inbox()')]
        function=function[:function.index('\n\tcase "$0" in')]+'''
    MBSYNCRC="$mbsyncrc" /bin/ksh -c 'print -r -- "$MBSYNCRC"'
}
'''
        config=self.home/'custom sync config'
        config.write_text('# synthetic config\n')
        script='mw_fail() { print -r -- "$*" >&2; }; '+function+'\nmw_sync'
        result=subprocess.run(['/bin/ksh','-c',script],env=dict(self.env,mbsyncrc=str(config)),
                              capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout,str(config)+'\n')

    def test_sync_refuses_legacy_secret_producer_before_execution(self):
        config=self.home/'.mbsyncrc'
        config.write_text('# mw account begin '+A+'\nPassCmd "legacy printf producer"\n# mw account end '+A+'\n')
        result=subprocess.run([str(self.candidate),'-y',A],env=self.env,capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('No credential command executed',result.stderr)
        self.assertFalse((self.home/'calls').exists())

    def test_google_normalization_is_endpoint_bound_and_exact_utf8(self):
        source=self.candidate.read_text()
        function=source[source.index('mw_normalize_password()'):source.index('mw_discard_stage()')]
        script='set +axv; mw_fail() { :; }; '+function+'\nMW_SECRET=$( /bin/cat ); mw_normalize_password || exit 1; print -rn -- "$MW_SECRET"'
        for endpoint,value,expected,status in [
                ('imap.gmail.com','abcd efgh\u00a0ijkl mnop\r','abcdefghijklmnop',0),
                ('imap.gmail.com','abcdefghijklmnop\u00a1','',1),
                ('imap.example.invalid','abcd efgh\u00a0ijkl mnop','abcd efgh\u00a0ijkl mnop',0)]:
            env=dict(self.env,imap=endpoint,fulladdr='synthetic@gmail.com')
            result=subprocess.run(['/bin/ksh','-c',script],input=value,text=True,capture_output=True,env=env)
            self.assertEqual(result.returncode,status,result.stderr)
            self.assertEqual(result.stdout,expected)

    def test_core_staged_network_retry_does_not_reinsert(self):
        self.ok(self.runmw(data='yes\n'+SECRET+'\nretry\nyes\n',fault='auth-once'))
        calls=[json.loads(x) for x in (self.home/'calls').read_text().splitlines()]
        self.assertEqual(sum(c[0]=='pass' and c[1][0]=='insert' for c in calls),1)
        self.assertEqual(sum(c[0]=='curl' for c in calls),2)

    def test_core_static_failure_categories(self):
        for status,reason in [(2,'configuration error'),(6,'DNS lookup'),(7,'TCP connection'),
                              (28,'timed out'),(35,'TLS verification'),(60,'TLS verification'),
                              (67,'Authentication rejected')]:
            p=self.runmw(data='yes\n'+SECRET+'\nquit\n',fault='curl-status-'+str(status))
            self.failed(p); self.assertIn(reason,p.stderr); self.assertFalse(self.pending.exists())
            self.assertFalse((self.store/(A+'.gpg')).exists())
        p=self.runmw(data='yes\n'+SECRET+'\nquit\n',fault='malformed-list')
        self.failed(p); self.assertIn('Malformed IMAP LIST',p.stderr)

    def test_core_prevalidation_and_custom_tls_port(self):
        for port in ['0','65536','1993oops']:
            self.failed(self.runmw(extra=['-a',A,'-i','localhost','-I',port]))
            self.assertFalse(self.pending.exists())
        self.failed(self.runmw(extra=['-a',A,'-i','127.0.0.1']))
        self.assertFalse(self.pending.exists())
        self.ok(self.runmw(extra=['-a',A,'-i','localhost','-I','1993']))
        self.assertIn('Port 1993',(self.home/'.mbsyncrc').read_text())
        self.ok(self.runmw(data='yes\n',extra=['-e',A,'-I','2993']))
        self.assertIn('Port 2993',(self.home/'.mbsyncrc').read_text())
        self.assertEqual(self.show(A),SECRET+'\n')

    def test_core_literal_names_and_plus_default(self):
        email='alice+notes@example.invalid'
        name='Zoë O\'Neil “reader” "quote" \\ literal'
        self.ok(self.runmw(email,extra=['-a',email,'-i','localhost','-n',name]))
        cfg=self.home/'.config/mutt/accounts'/ (email+'.muttrc')
        p=self.native(['neomutt','-F',str(cfg),'-Q','real_name'])
        self.assertIn('Zoë',p.stdout); self.assertIn("O'Neil",p.stdout)
        self.ok(self.runmw(email,data='yes\n',extra=['-e',email,'-n',name+' updated']))
        self.assertIn('updated',cfg.read_text())

    def test_real_curl_parser(self):
        cfg=self.curl_config()
        self.assertNotIn('connect-only',self.candidate.read_text())
        for args,data in [(['--connect-only','--help'],None),
                          (['--config','-','--help'],cfg+'connect-only\n')]:
            p=subprocess.run(['/usr/local/bin/curl','--disable',*args],input=data,
                             text=True,capture_output=True,env=self.env,timeout=10)
            self.assertEqual(p.returncode,2)
            self.assertIn('unknown',p.stderr.lower())
        p=subprocess.run(['/usr/local/bin/curl','--disable','--config','-','--help'],
                         input=cfg,text=True,capture_output=True,env=self.env,timeout=10)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertIn('Usage:',p.stdout)

    def test_real_curl_bad_ca_never_authenticates(self):
        # Only a disposable loopback listener. Same config producer and native
        # curl flags; ephemeral port substitutes for production port 993.
        import socket, ssl, threading
        cert=self.home/'fixture-cert'; key=self.home/'fixture-key'
        self.native(['openssl','req','-x509','-newkey','rsa:2048','-nodes',
                     '-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost'])
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert,key)
        listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(1); listener.settimeout(10)
        received=[]; errors=[]
        def serve():
            try:
                conn,_=listener.accept(); conn.settimeout(5)
                try:
                    with context.wrap_socket(conn,server_side=True) as tls:
                        tls.sendall(b'* OK synthetic IMAP\r\n'); received.append(tls.recv(4096))
                except (ssl.SSLError, OSError) as e: errors.append(str(e))
                finally: conn.close()
            finally: listener.close()
        port=str(listener.getsockname()[1]); worker=threading.Thread(target=serve); worker.start()
        try:
            p=subprocess.run(['/usr/local/bin/curl','--disable','--config','-'],
                             input=self.curl_config(port)+'user = "synthetic:synthetic"\n',
                             text=True,capture_output=True,env=self.env,timeout=15)
        finally: worker.join(12)
        self.assertFalse(worker.is_alive())
        self.assertEqual(p.returncode,60,p.stderr)
        # Depending on the TLS backend, the server sees either an alert/reset
        # during handshake or a completed handshake followed by immediate EOF.
        # Neither permits a single IMAP application byte, let alone LOGIN.
        self.assertFalse(any(received),repr(received))

    def test_endpoint_choices_and_tls_preservation(self):
        # Optional runner chunk preserves every consent variant across named
        # cases without making a ten-invocation method exceed its 30s budget.
        answers=[os.environ['MW_ENDPOINT_ANSWER']] if 'MW_ENDPOINT_ANSWER' in os.environ else ['', 'y', 'Y', 'yes', 'YeS']
        for answer in answers:
            self.failed(self.runmw(data=answer+'\n'+SECRET+'\nquit\n',fault='tls'))
            self.assertFalse((self.store/(A+'.gpg')).exists())
            self.assertFalse((self.home/'auth-released').exists())
            self.assertFalse((self.home/'.mbsyncrc').exists())
            self.assertFalse(self.pending.exists())
            self.assertTrue(list(self.pending.parent.glob('.mw-pending.cancelled.'+A+'.*')))
        calls=[line for line in (self.home/'calls').read_text().splitlines()
               if json.loads(line)[0] in ['pass','curl']]
        for answer in ['n','NO']:
            p=self.runmw(data=answer+'\n'); self.failed(p)
            self.assertIn('cancelled',p.stderr+p.stdout)
            self.assertEqual([line for line in (self.home/'calls').read_text().splitlines()
                              if json.loads(line)[0] in ['pass','curl']],calls)
        p=self.runmw(data='what\nedit\ncorrect.example.invalid\ncorrect@example.invalid\ny\n'+SECRET+'\nquit\n',fault='tls')
        self.failed(p)
        self.assertIn('Choose Enter, yes, no or edit.',p.stderr+p.stdout)
        self.assertIn('Server: imaps://correct.example.invalid:993; login: correct@example.invalid',p.stdout)
        self.assertFalse((self.home/'auth-released').exists())
        self.ok(self.runmw(data='\n'+SECRET+'\n'))
        cipher=(self.store/(A+'.gpg')).read_bytes(); configs=self.configs()
        released=(self.home/'auth-released').read_bytes()
        self.failed(self.lifecycle(['-e',A],data='\nquit\n',fault='tls'))
        self.assertEqual(cipher,(self.store/(A+'.gpg')).read_bytes())
        self.assertEqual(configs,self.configs())
        self.assertEqual(released,(self.home/'auth-released').read_bytes())
        self.assertFalse(self.pending.exists())
        archives=list(self.pending.parent.glob('.mw-pending.cancelled.'+A+'.*'))
        edit=next(p for p in archives if (p/'record').read_text().splitlines()[13]=='edit')
        record=(edit/'record').read_text().splitlines()
        self.assertEqual(record[10],'collecting')
        self.assertNotEqual(record[8],'-')
        self.assertTrue((edit/'original-mbsyncrc').is_file())

    def tty_endpoint(self, email, answer, edit=False):
        # Native controlling TTY, not --password-stdin. Observe the consent
        # boundary before supplying any action or synthetic credential.
        def credential_calls():
            path=self.home/'calls'
            return [line for line in path.read_text().splitlines() if json.loads(line)[0] in ['pass','curl']] if path.exists() else []
        calls=credential_calls()
        pid,fd=pty.fork()
        if pid==0:
            os.execve(str(self.candidate),[str(self.candidate),'-a',email,'-i','imap.example.invalid'],
                      dict(self.env,FAULT='tls'))
        script=[(b'Use this server?', answer.encode()+b'\n')]
        if edit:
            script += [(b'IMAP hostname:',b'correct.example.invalid\n'),
                       (b'Login:',b'correct@example.invalid\n'),
                       (b'Use this server?',b'\n')]
        if answer.lower() not in ['n','no']:
            script += [(b'App password: ',(SECRET+'\n').encode()),
                       (b'[retry/reenter/edit/quit]',b'quit\n')]
        transcript=b''; status=None; cursor=0; sent=0
        try:
            end=time.monotonic()+60
            while time.monotonic()<end:
                if select.select([fd],[],[],.05)[0]:
                    try: transcript+=os.read(fd,8192)
                    except OSError: pass
                if sent<len(script):
                    marker,response=script[sent]; found=transcript.find(marker,cursor)
                    if found>=0:
                        if marker==b'Use this server?':
                            self.assertEqual(credential_calls(),calls,'pass/curl ran before endpoint consent')
                        os.write(fd,response); cursor=found+len(marker); sent+=1
                got,st=os.waitpid(pid,os.WNOHANG)
                if got: status=st; break
            self.assertIsNotNone(status,transcript.decode(errors='replace'))
            self.assertNotEqual(os.waitstatus_to_exitcode(status),0)
            self.assertEqual(sent,len(script),transcript.decode(errors='replace'))
            self.assertNotIn(SECRET.encode(),transcript)
            self.assertIn(b'TLS is checked at sign-in',transcript)
            if edit: self.assertIn(b'Server: imaps://correct.example.invalid:993; login: correct@example.invalid',transcript)
            if answer.lower() in ['n','no']:
                self.assertIn(b'cancelled',transcript)
                self.assertNotIn(b'App password:',transcript)
        finally:
            if status is None: os.killpg(pid,signal.SIGKILL); os.waitpid(pid,0)
            os.close(fd)
        self.assertFalse((self.home/'auth-released').exists())
        return transcript

    def test_terminal_paste_reader_restore_reject_and_cancel(self):
        import termios
        source=self.candidate.read_text()
        reader=source.split("MW_SECRET=$(/usr/local/bin/python3 -c '\n",1)[1].split("\n')",1)[0]
        for payload,submit,expected in [
                (b'\x1b[200~single pasted value\x1b[201~',b'\r',0),
                (b'\x1b[200~first\nsecond\x1b[201~',b'\r',1),
                (b'first\nsecond\n',b'',1),
                (b'',b'\x03',130),
                (b'',b'\x1c',130),
                (b'',b'\x04',130)]:
            pid,fd=pty.fork()
            if pid==0:
                time.sleep(.1)
                os.execve('/usr/local/bin/python3',['python3','-c',reader],self.env)
            original=termios.tcgetattr(fd)
            transcript=b''; status=None
            try:
                deadline=time.monotonic()+5
                while b'App password: ' not in transcript and time.monotonic()<deadline:
                    if select.select([fd],[],[],.05)[0]: transcript+=os.read(fd,8192)
                self.assertIn(b'App password: ',transcript)
                os.write(fd,payload)
                time.sleep(.2)
                if submit: os.write(fd,submit)
                while time.monotonic()<deadline:
                    if select.select([fd],[],[],.05)[0]:
                        try: transcript+=os.read(fd,8192)
                        except OSError: pass
                    got,st=os.waitpid(pid,os.WNOHANG)
                    if got: status=st; break
                self.assertIsNotNone(status,repr(transcript))
                self.assertEqual(os.waitstatus_to_exitcode(status),expected,repr(transcript))
                restored=termios.tcgetattr(fd)
                restored[3] &= ~termios.PENDIN
                original[3] &= ~termios.PENDIN
                self.assertEqual(restored,original)
                if expected: self.assertNotIn(b'first',transcript)
                if payload:
                    self.assertIn(b'***',transcript)
                if expected == 0:
                    prompt_end=transcript.index(b'App password: ')+len(b'App password: ')
                    before_secret=transcript[prompt_end:transcript.index(b'\x1b[?2004l',prompt_end)]
                    self.assertNotIn(b'single pasted value',before_secret)
            finally:
                if status is None: os.kill(pid,signal.SIGKILL); os.waitpid(pid,0)
                os.close(fd)

    def test_root_endpoint_real_tty(self):
        for answer in ['n','','y','Y','yes']:
            self.tty_endpoint(A,answer)
        self.tty_endpoint(A,'edit',edit=True)
        self.assertFalse((self.store/(A+'.gpg')).exists())

    def test_namespace_endpoint_real_tty(self):
        mail=self.mail_policy()
        for answer in ['NO','','y','Y','yes']:
            transcript=self.tty_endpoint(A,answer)
            self.assertNotIn(b'Resuming unfinished setup',transcript)
            self.assertFalse(self.pending.exists())
        self.tty_endpoint(A,'edit',edit=True)
        self.assertFalse((mail/(A+'.gpg')).exists())
        self.ok(self.runmw(data='\n'+SECRET+'\n'))
        self.assertTrue((mail/(A+'.gpg')).is_file())

    def test_resume_real_tty_enter(self):
        self.failed(self.runmw(fault='parser',data='\n'+SECRET+'\nquit\n'))
        cipher=(self.store/(A+'.gpg')).read_bytes()
        pid,fd=pty.fork()
        if pid==0:
            os.execve(str(self.candidate),[str(self.candidate),'-a',A,'-i','imap.example.invalid'],self.env)
        transcript=b''; status=None; sent=False; resumed=False; deferred=False
        try:
            end=time.monotonic()+60
            while time.monotonic()<end:
                if select.select([fd],[],[],.05)[0]:
                    try: transcript+=os.read(fd,8192)
                    except OSError: pass
                if b'[resume/abandon]' in transcript and not resumed:
                    os.write(fd,b'resume\n'); resumed=True
                if b'Use this server?' in transcript and not sent:
                    self.assertNotIn(b'curl', (self.home/'calls').read_bytes().splitlines()[-1])
                    os.write(fd,b'\n'); sent=True
                if b'Choose [retry/open/later]' in transcript and not deferred:
                    os.write(fd,b'later\n'); deferred=True
                got,st=os.waitpid(pid,os.WNOHANG)
                if got: status=st; break
            self.assertIsNotNone(status,transcript.decode(errors='replace'))
            self.assertEqual(os.waitstatus_to_exitcode(status),0,transcript.decode(errors='replace'))
            self.assertTrue(sent)
            self.assertIn(b'Resuming unfinished setup',transcript)
            self.assertNotIn(b'Resume unfinished setup for',transcript)
            self.assertNotIn(b'App password:',transcript)
        finally:
            if status is None: os.killpg(pid,signal.SIGKILL); os.waitpid(pid,0)
            os.close(fd)
        self.assertEqual(cipher,(self.store/(A+'.gpg')).read_bytes())
        self.assertFalse(self.pending.exists())

    def legacy_core(self):
        self.skipTest("historical executable not shipped; no private Git history dependency")

    def legacy_collecting_resume(self, marker):
        old=self.legacy_core(); new=self.candidate
        self.candidate=old
        try: self.ok(self.runmw(B))
        finally: self.candidate=new
        # Seed an actual old paired-account snapshot with the historical
        # path/no-spaces peer inventory, then interrupt before verification.
        pid,fd=pty.fork()
        if pid==0:
            os.execve(str(old),[str(old),'-a',A,'-i','imap.example.invalid'],self.env)
        transcript=b''; status=None; interrupted=False; consent=False
        try:
            end=time.monotonic()+60
            while time.monotonic()<end:
                if select.select([fd],[],[],.05)[0]:
                    try: transcript+=os.read(fd,8192)
                    except OSError: pass
                if marker==b'App password: ' and b'Use this server?' in transcript and not consent:
                    os.write(fd,b'\n'); consent=True
                if marker in transcript and not interrupted:
                    os.write(fd,b'\x03'); interrupted=True
                got,st=os.waitpid(pid,os.WNOHANG)
                if got: status=st; break
            self.assertIsNotNone(status,transcript.decode(errors='replace'))
            self.assertTrue(interrupted); self.assertNotEqual(os.waitstatus_to_exitcode(status),0)
        finally:
            if status is None: os.killpg(pid,signal.SIGKILL); os.waitpid(pid,0)
            os.close(fd)
        record=(self.pending/'record').read_text().splitlines()
        self.assertEqual(record[0],'mw-pending-v4'); self.assertEqual(record[10],'collecting')
        self.assertFalse((self.store/(A+'.gpg')).exists())
        self.assertFalse((self.pending.parent/'.mw-active').exists())
        peer=(self.pending/'peers').read_text()
        self.assertIn(B,peer)
        before=(self.store/(B+'.gpg')).read_bytes()
        self.ok(self.runmw())
        self.assertEqual((self.store/(B+'.gpg')).read_bytes(),before)
        self.assertFalse(self.pending.exists())
        self.assertIn(b'auto_view text/html',self.read('.config/mutt/accounts/'+A+'.muttrc'))

    def test_afterrepair_old_consent_ctrl_c_resume(self):
        self.legacy_collecting_resume(b'Use this server?')

    def test_afterrepair_old_password_ctrl_c_resume(self):
        self.legacy_collecting_resume(b'App password: ')

    def test_afterrepair_old_saved_eacces_resume(self):
        old=self.legacy_core(); new=self.candidate
        self.candidate=old
        try: p=self.runmw(fault='sync-eacces',data='yes\n'+SECRET+'\nquit\n')
        finally: self.home.chmod(0o700); self.candidate=new
        self.failed(p); self.assertIn('Permission denied',p.stderr)
        record=(self.pending/'record').read_text().splitlines()
        self.assertEqual(record[0],'mw-pending-v4')
        self.assertIn(record[10],['credential-saved','config-pending'])
        cipher=(self.store/(A+'.gpg')).read_bytes()
        p=self.runmw(data='\n'); self.ok(p); self.assertNotIn('Password:',p.stdout)
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),cipher)
        self.assertIn('print -rn --',self.read('.mbsyncrc').decode())
        self.assertNotIn('printf',next(x for x in self.read('.mbsyncrc').decode().splitlines() if x.startswith('PassCmd ')))

    def test_afterrepair_legacy_printf_ordinary_edit(self):
        old=self.legacy_core(); new=self.candidate
        self.candidate=old
        try: self.ok(self.runmw(extra=['-a',A,'-i','localhost']))
        finally: self.candidate=new
        config=self.home/'.mbsyncrc'
        command=next(x for x in config.read_text().splitlines() if x.startswith('PassCmd '))
        self.assertIn('printf',command)
        cipher=(self.store/(A+'.gpg')).read_bytes()
        # Native config parse must not evaluate the old producer. Upgrade in
        # ordinary edit before selecting any channel for an actual sync.
        trace=self.home/'legacy-parse.ktrace'
        self.native(['/usr/bin/ktrace','-i','-t','xX','-f',str(trace),
                     '/usr/local/bin/mbsync','-c',str(config),'--list-stores',A+'-local'])
        dump=self.native(['/usr/bin/kdump','-t','xX','-f',str(trace)]).stdout
        self.assertNotIn('Synthetic-MW-Canary',dump); self.assertNotIn('/usr/local/bin/pass',dump)
        p=self.runmw(extra=['-e',A,'-n','Upgraded Identity'],data='\n',trace=self.home/'legacy-edit.ktrace')
        self.ok(p)
        dump=self.native(['/usr/bin/kdump','-t','xX','-f',str(self.home/'legacy-edit.ktrace')]).stdout
        self.assertNotIn('Synthetic-MW-Canary',dump)
        line=next(x for x in config.read_text().splitlines() if x.startswith('PassCmd '))
        self.assertNotIn('printf',line); self.assertIn('print -rn --',line)
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),cipher)

    def test_afterrepair_html_whitelist_exact(self):
        source=self.candidate.read_text()
        guard=source[source.index('mw_reader_safe()'):source.index('mw_transport()')]
        accounts=self.home/'empty-accounts'; accounts.mkdir()
        reader=self.home/'static-reader'
        for text,allowed in [
            ('auto_view text/html\nalternative_order text/plain text/html\n',True),
            ('auto_view text/plain\n',False),('auto_view text/html text/plain\n',False),
            ('alternative_order text/html text/plain\n',False),
            ('alternative_order text/plain text/html text/enriched\n',False),
            ('auto_view `touch forbidden`\n',False),
            ('source /usr/local/share/mutt-wizard/mutt-wizard.muttrc\n',False)]:
            with self.subTest(text=text):
                reader.write_text(text)
                p=subprocess.run(['/bin/ksh','-c',guard+'\naccdir=$1; mw_reader_safe "$2"',
                                  'fixture',str(accounts),str(reader)],env=self.env,capture_output=True)
                self.assertEqual(p.returncode==0,allowed,p.stderr)
        self.assertFalse((self.home/'forbidden').exists())

    def test_afterrepair_generated_profile_native(self):
        self.ok(self.runmw())
        text=self.read('.config/mutt/accounts/'+A+'.muttrc').decode()
        for expected in ['auto_view text/html','alternative_order text/plain text/html',
                'macro index,pager O ', 'LOCAL ONLY - S saves locally; O downloads; SENDING DISABLED',
                'macro compose y "<enter-command>echo \'Sending disabled; body/attachments retained. P postpones draft.\'<enter>"',
                'set sendmail = "/usr/bin/false"']:
            self.assertIn(expected,text)
        # The regular add already runs native parser and effective transport
        # probes. Explicit CLI parse also catches nested quote corruption.
        p=self.native(['neomutt','-n','-F',str(self.home/'.config/mutt/muttrc'),
                       '-Q','sendmail','-Q','smtp_url','-Q','compose_format','-Q','from'])
        self.assertEqual(p.stderr,''); self.assertIn('/usr/bin/false',p.stdout)
        self.assertIn(A,p.stdout); self.assertIn('SENDING DISABLED',p.stdout)
        self.ok(self.runmw(B)); self.ok(self.lifecycle(['-D',A])); self.ok(self.lifecycle(['-D',B]))
        self.assertNotIn(b'auto_view',self.read('.config/mutt/muttrc'))

    def test_build_and_continuity(self):
        drift=self.home/'drift'; drift.write_text('# drift\n')
        for out,base in [(self.home/'new',drift),(self.candidate,Path('/usr/local/bin/mw'))]:
            p=subprocess.run(['sh',str(ASSETS/'build'),str(out),str(base)],capture_output=True)
            self.assertNotEqual(p.returncode,0)
        s=self.candidate.read_text()
        self.assertIn('add) checkbasics && askinfo && getboxes && getprofiles && finalize',s)
        self.assertIn('prepmbsync && prepmsmtp && prepmutt',s)
        self.assertEqual(s.count('while getopts '),1)
        self.assertNotIn('PASSWORD_STORE_GIT',s)
        self.assertNotIn('pass rm',s)

    def test_new_A_then_B_native_parsers_foreign_preserved(self):
        # Foreign byte sequences remain a prefix, including whitespace/comments.
        foreign={'/.mbsyncrc':b'# foreign sync bytes\t\n',
                 '/.config/mutt/muttrc':b'# foreign reader bytes\t\n',
                 '/.config/mutt/smtp-draft.txt':b'# foreign draft bytes\t\n'}
        # Keep the reader empty except comments; first account must still default.
        for rel,content in foreign.items():
            f=self.home/rel.lstrip('/'); f.parent.mkdir(parents=True,exist_ok=True); f.write_bytes(content)
        self.ok(self.runmw())
        a=self.read('.config/mutt/accounts/'+A+'.muttrc')
        reader=self.read('.config/mutt/muttrc')
        self.assertIn(('source "'+str(self.home/'.config/mutt/accounts'/ (A+'.muttrc'))+'"').encode(),reader)
        self.ok(self.runmw(B))
        self.assertEqual(self.read('.config/mutt/accounts/'+A+'.muttrc'),a)
        self.assertTrue(self.read('.config/mutt/muttrc').startswith(reader))
        for rel,content in foreign.items(): self.assertTrue(self.read(rel.lstrip('/')).startswith(content))
        for email in [A,B]:
            self.assertEqual(self.show(email),SECRET+'\n')
            self.assertIn(('Channel '+email).encode(),self.read('.mbsyncrc'))
            self.assertIn(('account '+email).encode(),self.read('.config/mutt/smtp-draft.txt'))
        self.assertFalse(self.pending.exists())
        for email in [A, B]:
            inbox = self.home/'.local/share/mail'/email/'INBOX'
            for leaf in ['cur', 'new', 'tmp']:
                self.assertTrue((inbox/leaf).is_dir())
                self.assertEqual(list((inbox/leaf).iterdir()), [])
        merged_probe=self.home/'merged-inherited.muttrc'
        merged_probe.write_text('set smtp_url="smtps://inherited.invalid"\nset smtp_pass="inherited"\nset smtp_oauth_refresh_command="/usr/bin/false"\nsource "'+str(self.home/'.config/mutt/muttrc')+'"\n')
        actual=self.native(['neomutt','-F',str(merged_probe),'-Q','smtp_url','-Q','smtp_pass','-Q','smtp_oauth_refresh_command','-Q','sendmail']).stdout
        self.assertEqual(actual,'set smtp_url = ""\nset smtp_pass = ""\nset smtp_oauth_refresh_command = ""\nset sendmail = "/usr/bin/false"\n')

    def test_parser_and_write_retry_immediate(self):
        for email,fault in [(A,'parser-once'),(B,'write-once')]:
            self.ok(self.runmw(email,data='yes\n'+SECRET+'\nunknown-choice\nretry\n',fault=fault))
            self.assertEqual(self.show(email),SECRET+'\n')

    def test_checkpoint_next_invocation_resume(self):
        self.failed(self.runmw(fault='parser',data='yes\n'+SECRET+'\nquit\n'))
        cipher=(self.store/(A+'.gpg')).read_bytes()
        self.assertIn('credential-saved', (self.pending/'record').read_text())
        self.assertFalse((self.home/'.mbsyncrc').exists())
        self.ok(self.runmw(data='\n'))
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),cipher)
        self.ok(self.runmw(B))

    def test_invalid_only_staged_and_correct_retry(self):
        self.failed(self.runmw(fault='auth',data='yes\n'+SECRET+'\nquit\n'))
        self.assertFalse((self.store/(A+'.gpg')).exists())
        self.ok(self.runmw(data='yes\n'+SECRET+'\nunknown-choice\nretry\nyes\n'+SECRET+'\n',fault='auth-once'))

    def test_marker_failure_restores_A_before_resume_B(self):
        self.ok(self.runmw())
        prior={p:self.read(p) for p in ['.mbsyncrc','.config/mutt/muttrc','.config/mutt/smtp-draft.txt']}
        self.failed(self.runmw(B,fault='marker',data='yes\n'+SECRET+'\nquit\n'))
        for p,v in prior.items(): self.assertEqual(self.read(p),v)
        self.assertEqual(self.show(B),SECRET+'\n')
        self.ok(self.runmw(B,data='\n'))

    def test_external_edit_guard_and_symlink(self):
        self.failed(self.runmw(fault='external-edit'))
        self.assertEqual(self.read('.mbsyncrc'),b'# external edit\n')
        self.failed(self.runmw(data='\n'))
        self.assertEqual(self.read('.mbsyncrc'),b'# external edit\n')

    def test_late_symlink(self):
        foreign=self.home/'foreign'; foreign.write_text('untouched')
        self.failed(self.runmw(fault='late-symlink'))
        self.assertEqual(foreign.read_text(),'untouched')

    def test_published_external_edit_retained(self):
        self.failed(self.runmw(fault='edit-published',data='yes\n'+SECRET+'\nquit\n'))
        self.assertEqual(self.read('.mbsyncrc'),b'# external published edit\n')
        self.assertTrue((self.pending/'published-mbsyncrc').exists())

    def test_credential_collision(self):
        self.failed(self.runmw(fault='credential-collision'))
        self.assertEqual((self.store/(A+'.gpg')).read_text(),'foreign ciphertext')

    def test_legacy_refused(self):
        (self.home/'.mbsyncrc').write_text('IMAPStore legacy\nHost nowhere.invalid\n')
        self.failed(self.runmw())
        self.assertFalse((self.store/(A+'.gpg')).exists())
        (self.home/'.mbsyncrc').write_text('# static foreign bytes\n')
        reader=self.home/'.config/mutt/muttrc'
        for text in ['source "foreign.muttrc"\n', 'ifdef imap "macro index i1 x"\n']:
            reader.write_text(text)
            self.failed(self.runmw())
            self.assertEqual(reader.read_text(),text)
            self.assertFalse((self.store/(A+'.gpg')).exists())

    def test_binding_collision_more_than_nine(self):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        reader.write_text(''.join('macro index,pager i'+str(n)+' "<noop>"\n' for n in range(1,10)))
        # i1..i9 prefix-claim all decimal bindings: fail rather than steal a macro.
        self.failed(self.runmw())
        self.assertNotIn('switch to',reader.read_text())

    def test_multidigit_binding(self):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        reader.write_text('macro index,pager i1 "<noop>"\n')
        self.ok(self.runmw())
        self.assertIn('macro index,pager i2<Enter> ',reader.read_text())
        # Existing unambiguous managed selectors numbered >9 must not be parsed
        # by a single digit extraction or account-number arithmetic.
        reader.write_text(reader.read_text().replace('i2<Enter> ', 'i42<Enter> ').replace('i2<Return> ', 'i42<Return> '))
        before=reader.read_text()
        owned42=[line for line in before.splitlines() if ' i42<' in line]
        self.assertEqual(len(owned42),2)
        self.ok(self.runmw(B))
        self.assertIn('macro index,pager i42<Enter> ',reader.read_text())
        self.assertIn('macro index,pager i2<Enter> ',reader.read_text())
        for line in owned42:
            self.assertIn(line,reader.read_text())
            self.assertIn('switch to '+A,line)
        for suffix in ('Enter','Return'):
            line=next(line for line in reader.read_text().splitlines() if ' i2<'+suffix+'> ' in line)
            self.assertIn('switch to '+B,line)

    def test_multidigit_single_alias_reserves_original(self):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        reader.write_text('macro index,pager i1 "<noop>"\n')
        self.ok(self.runmw())
        reader.write_text(reader.read_text().replace('i2<Enter> ', 'i42<Enter> '))
        owned=[line for line in reader.read_text().splitlines() if 'switch to '+A in line]
        self.assertEqual(len(owned),2)
        self.ok(self.runmw(B))
        for line in owned:
            self.assertIn(line,reader.read_text())
        for suffix in ('Enter','Return'):
            line=next(line for line in reader.read_text().splitlines() if ' i3<'+suffix+'> ' in line)
            self.assertIn('switch to '+B,line)
        self.assertFalse(any(' i2<Enter> ' in line and 'switch to '+B in line for line in reader.read_text().splitlines()))

    def test_tenth_account_selector(self):
        first='account1@example.invalid'
        self.ok(self.runmw(first))
        # Seed accounts 2..9 from the actual original-generator output. This
        # tests a ten-account merged parser/selector without exceeding the
        # harness's 30s per-case watchdog. A->B creation is tested independently.
        account=self.home/'.config/mutt/accounts'/(first+'.muttrc')
        base=account.read_text()
        shared=[self.home/p for p in ['.mbsyncrc','.config/mutt/muttrc','.config/mutt/smtp-draft.txt']]
        blocks=[]
        for path in shared:
            text=path.read_text(); start=text.index('# mw account begin '+first)
            block=text[start:]
            if path.name=='muttrc':
                block='\n'.join(line for line in block.split('\n') if not line.startswith('source '))
            blocks.append(block)
        for n in range(2,10):
            email='account'+str(n)+'@example.invalid'
            f=account.with_name(email+'.muttrc'); f.write_text(base.replace(first,email)); f.chmod(0o600)
            for path,block in zip(shared,blocks):
                with path.open('a') as out: out.write('\n'+block.replace(first,email).replace('i1<Enter>',f'i{n}<Enter>'))
        self.ok(self.runmw('account10@example.invalid'))
        reader=self.read('.config/mutt/muttrc')
        self.assertIn(b'macro index,pager i10<Enter> ',reader)
        self.assertIn(b'macro index,pager i1<Enter> ',reader)

    def mail_policy(self, signed=False):
        """Second synthetic recipient; never initialize in the Git-backed store."""
        self.native(['gpg','--batch','--pinentry-mode','loopback','--passphrase','',
                     '--quick-generate-key','Mail Synthetic <mail@example.invalid>','ed25519','cert','0'])
        keys=self.native(['gpg','--with-colons','--list-secret-keys']).stdout
        self.mail_fpr=[x.split(':')[9] for x in keys.splitlines() if x.startswith('fpr:')][-1]
        self.native(['gpg','--batch','--pinentry-mode','loopback','--passphrase','',
                     '--quick-add-key',self.mail_fpr,'cv25519','encr','0'])
        stage=self.home/'policy-stage'
        if signed:
            self.native(['gpg','--batch','--pinentry-mode','loopback','--passphrase','',
                         '--quick-add-key',self.mail_fpr,'ed25519','sign','0'])
        self.native(['env','-u','PASSWORD_STORE_KEY',
                     'PASSWORD_STORE_DIR='+str(stage),
                     'PASSWORD_STORE_SIGNING_KEY='+(self.mail_fpr if signed else ''),
                     'pass','init',self.mail_fpr])
        if signed:
            self.assertTrue((stage/'.gpg-id.sig').is_file())
        mail=self.store/'mail'; mail.mkdir(mode=0o700)
        for meta in stage.iterdir():
            os.link(meta,mail/meta.name)  # absent-only native metadata publication
        (mail/'foreign').write_text('mail namespace foreign\n')
        self.mail_before={p:p.read_bytes() for p in mail.iterdir()}
        return mail

    def test_namespace_native_recipients_and_next_invocation(self):
        root=(self.store/'.gpg-id').read_bytes()
        mail=self.mail_policy()
        self.ok(self.runmw())
        self.ok(self.runmw(B))  # no new command or inherited namespace option
        for email in (A,B):
            self.assertFalse((self.store/(email+'.gpg')).exists())
            self.assertEqual(self.show('mail/'+email),SECRET+'\n')
            packets=self.native(['gpg','--batch','--list-packets',str(mail/(email+'.gpg'))]).stdout
            keys=self.native(['gpg','--with-colons','--list-keys',self.mail_fpr]).stdout
            encryption_id=next(x.split(':')[4] for x in keys.splitlines() if x.startswith('sub:') and 'e' in x.split(':')[11])
            self.assertIn('keyid '+encryption_id,packets)
        self.assertEqual((self.store/'.gpg-id').read_bytes(),root)
        for p,data in self.mail_before.items(): self.assertEqual(p.read_bytes(),data)
        archive=next((self.home/'.config/mutt').glob('.mw-pending.complete.*'))
        record=(archive/'record').read_text().splitlines()
        self.assertEqual(record[14:18],['mail/'+A,str(mail),hashlib.sha256((mail/'.gpg-id').read_bytes()).hexdigest(),'absent'])
        self.assertFalse(Path(record[7]).exists())
        config=self.read('.mbsyncrc').decode()
        self.assert_bound_passcmd(config,self.store,'mail/'+A)

    def test_namespace_signed_and_conflicting_overrides(self):
        mail=self.mail_policy(signed=True)
        self.env['PASSWORD_STORE_KEY']=self.fpr
        self.failed(self.runmw())
        self.assertFalse(self.pending.exists())
        self.env['PASSWORD_STORE_KEY']=self.mail_fpr
        self.env['PASSWORD_STORE_SIGNING_KEY']=self.fpr
        self.failed(self.runmw())
        self.env['PASSWORD_STORE_SIGNING_KEY']=self.mail_fpr
        self.env['PASSWORD_STORE_GPG_OPTS']='--recipient '+self.fpr
        self.failed(self.runmw())
        del self.env['PASSWORD_STORE_GPG_OPTS']
        self.ok(self.runmw())
        self.assertEqual(self.show('mail/'+A),SECRET+'\n')
        (mail/'.gpg-id.sig').write_bytes(b'invalid synthetic signature')
        self.failed(self.runmw(B))

    def trace_native_verification(self):
        """Trace the installed pass -> installed gpg boundary, never plaintext/IDs."""
        self.env.pop('PASSWORD_STORE_KEY', None)
        self.env['PASSWORD_STORE_SIGNING_KEY']=self.mail_fpr
        self.env['MW_TRACE_NATIVE_VERIFY']='1'
        shim=self.bin/'gpg'
        shim.write_text('''#!/usr/local/bin/python3
import json, os, subprocess, sys
from pathlib import Path
p=subprocess.run(['/usr/local/bin/gpg',*sys.argv[1:]])
if '--verify' in sys.argv:
    with (Path(os.environ['HOME'])/'native-verify').open('a') as f:
        f.write(json.dumps(dict(native=os.environ.get('MW_NATIVE_PASS',''),
            store=os.environ.get('PASSWORD_STORE_DIR',''),
            override=bool(os.environ.get('PASSWORD_STORE_KEY')),
            pinned=bool(os.environ.get('PASSWORD_STORE_SIGNING_KEY')),
            policy=str(Path(sys.argv[-1])), status=p.returncode))+'\\n')
sys.exit(p.returncode)
''')
        shim.chmod(0o700)

    def verification_trace(self):
        trace=self.home/'native-verify'
        return [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []

    def assert_namespace_refusal_artifacts(self, mail):
        self.assertFalse((mail/(A+'.gpg')).exists())
        self.assertFalse((self.store/(A+'.gpg')).exists())
        self.assertFalse(self.pending.exists())
        self.assertEqual(list(self.home.glob('.mw-credential.*')),[])
        self.assertEqual(list((self.home/'.config/mutt').glob('.mw-pending.complete.*')),[])
        calls=self.home/'calls'
        if calls.exists():
            self.assertFalse(any(json.loads(line)[0] in ('curl','pass')
                                 for line in calls.read_text().splitlines()))

    def test_namespace_signed_native_verification_without_key_override(self):
        root=(self.store/'.gpg-id').read_bytes()
        mail=self.mail_policy(signed=True)
        self.trace_native_verification()
        self.ok(self.runmw())
        self.assertNotIn('PASSWORD_STORE_KEY',self.env)
        self.assertEqual(self.show('mail/'+A),SECRET+'\n')
        archive=next((self.home/'.config/mutt').glob('.mw-pending.complete.*'))
        record=(archive/'record').read_text().splitlines()
        stage=Path(record[7])
        self.assertNotEqual(stage,self.store)
        self.assertNotEqual(stage,mail)
        self.assertFalse(stage.exists())
        self.assertEqual(record[16],hashlib.sha256((mail/'.gpg-id').read_bytes()).hexdigest())
        self.assertEqual(record[17],hashlib.sha256((mail/'.gpg-id.sig').read_bytes()).hexdigest())
        self.assertNotEqual(subprocess.run(['git','-C',str(stage),'rev-parse',
                            '--is-inside-work-tree'],env=self.env,
                            capture_output=True,timeout=20).returncode,0)
        verified=[v for v in self.verification_trace() if v['native']=='1']
        self.assertTrue(verified)
        self.assertEqual(verified,[dict(native='1',store=str(stage),override=False,
                                        pinned=True,policy=str(stage/'.gpg-id'),status=0)])
        # Inspect recipient metadata, not successful decryption alone: both
        # synthetic private keys are present, so decryption cannot distinguish A/B.
        packets=self.native(['gpg','--batch','--list-packets',str(mail/(A+'.gpg'))]).stdout
        keys=self.native(['gpg','--with-colons','--list-keys',self.mail_fpr]).stdout
        recipient=next(x.split(':')[4] for x in keys.splitlines()
                       if x.startswith('sub:') and 'e' in x.split(':')[11])
        self.assertIn('keyid '+recipient,packets)
        self.assertEqual((self.store/'.gpg-id').read_bytes(),root)
        for p,data in self.mail_before.items(): self.assertEqual(p.read_bytes(),data)

    def native_signed_refusal(self, wrong_pin=False):
        mail=self.mail_policy(signed=True)
        self.trace_native_verification()
        if wrong_pin: self.env['PASSWORD_STORE_SIGNING_KEY']=self.fpr
        else: (mail/'.gpg-id.sig').write_bytes(b'invalid synthetic signature')
        self.failed(self.runmw())
        self.assert_namespace_refusal_artifacts(mail)
        self.assertFalse(any(v['native'] for v in self.verification_trace()))
        # MW refuses before insert; independently exercise native nearest-policy
        # verification. Native pass may return zero after a late failure, so the
        # diagnostic and absent ciphertext, not exit status, establish refusal.
        direct=self.home/'direct-native'; direct.mkdir(mode=0o700)
        nested=direct/'mail'; nested.mkdir(mode=0o700)
        (direct/'.gpg-id').write_bytes((self.store/'.gpg-id').read_bytes())
        for meta in ('.gpg-id','.gpg-id.sig'):
            (nested/meta).write_bytes((mail/meta).read_bytes())
        p=subprocess.run(['/usr/local/bin/pass','insert','-m','-f','mail/probe'],
                         input=SECRET+'\n',text=True,capture_output=True,timeout=20,
                         env=dict(self.env,PASSWORD_STORE_DIR=str(direct),MW_NATIVE_PASS='direct'))
        self.assertNotIn(SECRET,p.stdout+p.stderr)
        self.assertIn('is invalid',p.stderr)
        self.assertEqual(list(direct.rglob('*.gpg')),[])
        verified=[v for v in self.verification_trace() if v['native']=='direct']
        self.assertEqual(len(verified),1)
        self.assertEqual(verified[0],dict(native='direct',store=str(direct),override=False,
                         pinned=True,policy=str(nested/'.gpg-id'),status=0 if wrong_pin else 2))
        self.assert_namespace_refusal_artifacts(mail)

    def test_namespace_signed_native_tampered_refusal(self):
        self.native_signed_refusal()

    def test_namespace_signed_native_wrong_pin_refusal(self):
        self.native_signed_refusal(wrong_pin=True)

    def test_namespace_unsafe_policy(self):
        mail=self.mail_policy()
        policy=mail/'.gpg-id'; data=policy.read_bytes()
        policy.unlink(); policy.symlink_to(self.store/'.gpg-id')
        self.failed(self.runmw())
        policy.unlink(); policy.write_bytes(data); policy.chmod(0o666)
        self.failed(self.runmw())
        policy.chmod(0o600); mail.chmod(0o777)
        self.failed(self.runmw())
        mail.chmod(0o700)
        (mail/(A+'.gpg')).symlink_to(self.store/'foreign')
        self.failed(self.runmw())
        self.assertFalse(self.pending.exists())

    def test_namespace_policy_change_and_resume_refused(self):
        mail=self.mail_policy()
        self.failed(self.runmw(fault='mail-policy-change',data='yes\n'+SECRET+'\nquit\n'))
        self.assertFalse((mail/(A+'.gpg')).exists())
        self.assertTrue(self.pending.exists())
        self.failed(self.runmw(data='\n'+SECRET+'\n'))
        self.assertFalse((mail/(A+'.gpg')).exists())

    def test_namespace_resume_collision_and_retry(self):
        mail=self.mail_policy()
        self.failed(self.runmw(fault='parser',data='yes\n'+SECRET+'\nquit\n'))
        cipher=(mail/(A+'.gpg')).read_bytes()
        self.ok(self.runmw(data='\n'))
        self.assertEqual((mail/(A+'.gpg')).read_bytes(),cipher)
        self.failed(self.runmw(B,fault='credential-collision'))
        self.assertEqual((mail/(B+'.gpg')).read_text(),'foreign ciphertext')

    def test_namespace_legacy_root_recognized_without_reinterpretation(self):
        self.ok(self.runmw())
        config=self.home/'.mbsyncrc'
        # Exact installed pre-namespace format, not an arbitrary executable ref.
        source=self.candidate.read_text()
        generator=source[source.index('mw_passcmd()'):source.index('mw_shquote()')]
        legacy=self.native(['/bin/ksh','-c',generator+'\nmw_ref=$1; mw_passcmd legacy','fixture',A]).stdout.strip()
        text=config.read_text()
        line=next(x for x in text.splitlines() if x.startswith('PassCmd '))
        self.assertIn('printf',legacy)
        config.write_text(text.replace(line,legacy))
        root=(self.store/(A+'.gpg')).read_bytes()
        self.mail_policy()
        self.ok(self.lifecycle(['-e',A,'-n','Still Root']))
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),root)
        self.assertFalse((self.store/'mail'/(A+'.gpg')).exists())
        self.assert_bound_passcmd(config.read_text(),self.store,A)
        self.ok(self.lifecycle(['-R',A]))
        self.ok(self.lifecycle(['-D',A]))
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),root)

    def test_namespace_unrecognized_legacy_refused(self):
        self.ok(self.runmw())
        self.mail_policy()
        config=self.home/'.mbsyncrc'
        text=config.read_text(); line=next(x for x in text.splitlines() if x.startswith('PassCmd '))
        config.write_text(text.replace(line,line.replace(A,'other@example.invalid')))
        before=self.configs()
        self.failed(self.lifecycle(['-e',A]))
        self.assertEqual(self.configs(),before)

    def test_namespace_without_policy_keeps_root(self):
        mail=self.store/'mail'; mail.mkdir(mode=0o700)
        foreign=mail/'foreign'; foreign.write_text('unrelated namespace file\n')
        self.ok(self.runmw())
        self.assertEqual(self.show(A),SECRET+'\n')
        self.assertFalse((mail/(A+'.gpg')).exists())
        self.assertEqual(foreign.read_text(),'unrelated namespace file\n')
        self.assertFalse((mail/'.gpg-id').exists())

    def test_namespace_absent_store_not_initialized(self):
        self.store.rename(self.home/'preserved-store')
        p=subprocess.run([str(self.candidate),'--password-stdin','-a',A,'-i','imap.example.invalid'],
                         input='yes\n'+SECRET+'\n',text=True,env=self.env,capture_output=True,timeout=20)
        self.failed(p)
        self.assertFalse(self.store.exists())
        self.assertFalse(self.pending.exists())
        self.assertFalse((self.home/'calls').exists())

    def test_namespace_nondefault_active_store(self):
        active=self.home/'active-store'
        self.store.rename(active); self.store=active
        self.env.update(PASSWORD_STORE_DIR=str(active),FIXTURE_STORE=str(active))
        self.mail_policy()
        self.ok(self.runmw())
        self.assertFalse((self.home/'.password-store').exists())
        self.assertEqual(self.show('mail/'+A),SECRET+'\n')
        self.assert_bound_passcmd(self.read('.mbsyncrc').decode(),active,'mail/'+A)

    def test_namespace_lifecycle_ABC(self):
        self.mail_policy()
        self.test_lifecycle_edit_default_remove_ABC()
        for email in (A,B,'carol@example.invalid'):
            self.assertEqual(self.show('mail/'+email),SECRET+'\n')

    def test_signed_recipient_metadata_and_key_override(self):
        self.native(['gpg','--batch','--pinentry-mode','loopback','--passphrase','',
                     '--quick-add-key',self.fpr,'ed25519','sign','0'])
        signature=self.store/'.gpg-id.sig'
        self.native(['gpg','--batch','--pinentry-mode','loopback','--passphrase','',
                     '--local-user',self.fpr,'--detach-sign','--output',str(signature),str(self.store/'.gpg-id')])
        before=signature.read_bytes()
        self.env.update(PASSWORD_STORE_KEY=self.fpr,PASSWORD_STORE_SIGNING_KEY=self.fpr)
        self.ok(self.runmw())
        self.assertEqual(signature.read_bytes(),before)
        archive=next((self.home/'.config/mutt').glob('.mw-pending.complete.*'))
        stage=Path((archive/'record').read_text().splitlines()[7])
        self.assertFalse(stage.exists())
        self.assertEqual(self.show(A),SECRET+'\n')

    def test_stage_outside_git_required(self):
        self.native(['git','-C',str(self.home),'init','-q'])
        self.failed(self.runmw())
        self.assertFalse((self.store/(A+'.gpg')).exists())

    def test_inherited_git_variables_cleared(self):
        self.env.update(GIT_DIR=str(self.store/'.git'),GIT_WORK_TREE=str(self.store),
                        GIT_INDEX_FILE=str(self.store/'.git/index'))
        self.ok(self.runmw())

    def test_committed_archive_gap(self):
        self.ok(self.runmw())
        archive=next((self.home/'.config/mutt').glob('.mw-pending.complete.*'))
        archive.rename(self.pending)
        self.ok(self.runmw(B))
        self.assertFalse(self.pending.exists())

    def test_removal_refused(self):
        self.ok(self.runmw())
        message=self.home/'.local/share/mail'/A/'INBOX/new/msg'; message.parent.mkdir(parents=True,exist_ok=True); message.write_text('mail')
        for args in [['-X'],['-x','nope']]: self.failed(self.runmw(extra=args))
        self.failed(self.runmw(extra=['-d'],data=A+'\nno\n'))
        self.assertEqual(message.read_text(),'mail')
        self.assertEqual(self.show(A),SECRET+'\n')

    def configs(self):
        return {p:self.read(p) for p in ['.mbsyncrc','.config/mutt/muttrc',
                '.config/mutt/smtp-draft.txt','.config/mutt/accounts/'+A+'.muttrc']}

    def lifecycle(self,args,data='yes\n',fault=''):
        return self.runmw(extra=args,data=data,fault=fault)

    def test_lifecycle_edit_default_remove_ABC(self):
        c='carol@example.invalid'
        for email in [A,B,c]: self.ok(self.runmw(email))
        messages=[]
        for email in [A,B,c]:
            p=self.home/'.local/share/mail'/email/'INBOX/new/synthetic'
            p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(b'fixture mail\x00unchanged'); messages.append(p)
        cipher={p:p.read_bytes() for p in self.store.rglob('*.gpg')}
        reader=self.home/'.config/mutt/muttrc'
        foreign='\n# foreign suffix\nbind pager zz noop\n'
        with reader.open('a') as out: out.write(foreign)
        oldreader=reader.read_bytes()
        self.ok(self.lifecycle(['-e',B,'-n','Bob Updated','-u','bob-login','-i','new.example.invalid']))
        self.assertEqual(reader.read_bytes(),oldreader)
        self.assertIn(b'set realname = "Bob Updated"',self.read('.config/mutt/accounts/'+B+'.muttrc'))
        sync=self.read('.mbsyncrc'); self.assertIn(b'Host new.example.invalid',sync); self.assertIn(b'User bob-login',sync)
        self.ok(self.lifecycle(['-R',B]))
        self.assertEqual(reader.read_text().count('source "'+str(self.home/'.config/mutt/accounts'/(B+'.muttrc'))+'"'),1)
        self.assertNotIn('source "'+str(self.home/'.config/mutt/accounts'/(A+'.muttrc'))+'"',reader.read_text())
        self.assertIn('i1<Enter>',reader.read_text()); self.assertIn('i3<Enter>',reader.read_text())
        # Remove default B, deterministic survivor A; remove middle C, then last.
        self.ok(self.lifecycle(['-D',B],data=''))
        self.assertIn('source "'+str(self.home/'.config/mutt/accounts'/(A+'.muttrc'))+'"',reader.read_text())
        self.ok(self.lifecycle(['-d'],data=c+'\nyes\n'))
        self.ok(self.lifecycle(['-D',A],data=''))
        self.assertNotIn('source ',reader.read_text()); self.assertNotIn('switch to',reader.read_text())
        self.assertIn(foreign,reader.read_text())
        for email in [A,B,c,'unknown@example.invalid']:
            self.failed(self.lifecycle(['-D',email],data=''))
        self.assertFalse(self.pending.exists())
        for p,value in cipher.items(): self.assertEqual(p.read_bytes(),value)
        for p in messages: self.assertEqual(p.read_bytes(),b'fixture mail\x00unchanged')
        self.ok(self.runmw('dave@example.invalid'))
        self.assertIn('source ',reader.read_text())

    def test_lifecycle_email_metacharacters(self):
        email='a.b+tag@example.invalid'
        self.ok(self.runmw(email,extra=['-a',email,'-i','imap.example.invalid','-n','Tagged']))
        self.ok(self.runmw(B))
        before=self.read('.config/mutt/accounts/'+B+'.muttrc')
        self.ok(self.lifecycle(['-R',B])); self.ok(self.lifecycle(['-D',email],data=''))
        self.assertEqual(self.read('.config/mutt/accounts/'+B+'.muttrc'),before)
        self.assertNotIn(email.encode(),self.read('.mbsyncrc'))
        self.assertTrue((self.store/(email+'.gpg')).exists())

    def test_lifecycle_edit_native_metadata_preserved(self):
        self.native(['pass','insert','-m',A],SECRET+'\nmetadata: unchanged\n')
        self.before=self.git_snapshot(); (self.home/'hook-ran').unlink(missing_ok=True)
        self.ok(self.runmw(data='yes\n'))
        account=self.home/'.config/mutt/accounts'/(A+'.muttrc')
        with account.open('a') as out: out.write('# foreign account suffix\nset sort = date\n')
        before=(self.store/(A+'.gpg')).read_bytes()
        self.ok(self.lifecycle(['-e',A,'-n','Alice New']))
        self.assertIn('# foreign account suffix\nset sort = date\n',account.read_text())
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),before)
        self.assertEqual(self.show(A),SECRET+'\nmetadata: unchanged\n')
        self.assertIn(b'Host imap.example.invalid',self.read('.mbsyncrc'))
        self.failed(self.lifecycle(['-e',A,'-a',B]))

    def eof_refusal(self,relative,suffix):
        self.ok(self.runmw()); self.ok(self.runmw(B))
        path=self.home/relative
        path.write_bytes(path.read_bytes()+suffix)
        before=self.configs()
        calls=self.home/'calls'
        for args,data in [(['-a','carol@example.invalid','-i','imap.example.invalid'],'yes\n'+SECRET+'\n'),
                          (['-e',B,'-n','New Name'],'yes\n'),
                          (['-R',B],'yes\n'),(['-D',B],'')]:
            with self.subTest(args=args):
                calls.unlink(missing_ok=True)
                p=self.runmw(data=data,extra=args); self.failed(p)
                self.assertIn('unsupported missing final newline',p.stdout+p.stderr)
                self.assertEqual(self.configs(),before)
                self.assertFalse(self.pending.exists())
                self.assertFalse(calls.exists())
                self.assertFalse((self.store/'carol@example.invalid.gpg').exists())

    def invalid_peer(self,args,data):
        self.ok(self.runmw()); self.ok(self.runmw(B))
        c='carol@example.invalid'; self.ok(self.runmw(c))
        peer=self.home/'.config/mutt/accounts'/(c+'.muttrc')
        with peer.open('a') as out: out.write('set definitely_not_a_neomutt_variable = yes\n')
        before=self.configs(); calls=self.home/'calls'; calls.unlink()
        p=self.runmw(extra=args,data=data); self.failed(p)
        self.assertEqual(self.configs(),before)
        self.assertFalse((self.pending/'published-account').exists())
        self.assertIn('Unknown option definitely_not_a_neomutt_variable',p.stdout+p.stderr)
        self.assertIn('neomutt',calls.read_text())

    def test_lifecycle_peer_invalid_edit(self): self.invalid_peer(['-e',B,'-n','New Bob'],'yes\nquit\n')
    def test_lifecycle_peer_invalid_default(self): self.invalid_peer(['-R',B],'yes\nquit\n')
    def test_lifecycle_peer_invalid_remove(self): self.invalid_peer(['-D',B],'quit\n')
    def test_lifecycle_peer_invalid_add(self): self.invalid_peer(['-a','dave@example.invalid','-i','imap.example.invalid'],'yes\n'+SECRET+'\nquit\n')

    def test_lifecycle_generated_alias_name_edit(self):
        email='a.b+tag@example.invalid'; old='Old.Name - Person_2'; new='New Person-3'
        self.ok(self.runmw(email,extra=['-a',email,'-i','imap.example.invalid','-n',old]))
        account=self.home/'.config/mutt/accounts'/(email+'.muttrc')
        foreign=b'alias other Someone Else <else@example.invalid>\n# foreign alias comment\n'
        account.write_bytes(account.read_bytes()+foreign)
        before=account.read_bytes()
        self.ok(self.lifecycle(['-e',email,'-n',new]))
        expected=before.replace(('set realname = "'+old+'"').encode(),('set realname = "'+new+'"').encode()).replace(
            ('alias me "'+old+'" <'+email+'>').encode(),('alias me "'+new+'" <'+email+'>').encode())
        self.assertEqual(account.read_bytes(),expected)

    def test_lifecycle_ambiguous_self_alias_refused(self):
        self.ok(self.runmw())
        account=self.home/'.config/mutt/accounts'/(A+'.muttrc'); original=account.read_bytes()
        for alias in [b'alias me Foreign <other@example.invalid>\n',
                      b'alias "me" Foreign <other@example.invalid>\n',
                      b"alias 'me' Foreign <other@example.invalid>\n"]:
            account.write_bytes(original+alias); before=self.configs()
            p=self.lifecycle(['-e',A,'-n','New Name']); self.failed(p)
            self.assertIn('exact generated self-alias',p.stdout+p.stderr)
            self.assertEqual(self.configs(),before); self.assertFalse(self.pending.exists())
        account.write_bytes(original.replace(('alias me "alice" <'+A+'>').encode(),b'alias me Foreign <other@example.invalid>'))
        p=self.lifecycle(['-e',A,'-n','New Name']); self.failed(p)
        self.assertIn('exact generated self-alias',p.stdout+p.stderr)

    def test_lifecycle_edit_failed_auth_unchanged(self):
        self.ok(self.runmw()); before=self.configs()
        cipher=(self.store/(A+'.gpg')).read_bytes()
        self.failed(self.lifecycle(['-e',A,'-i','changed.example.invalid'],data='yes\nquit\n',fault='auth'))
        self.assertEqual(self.configs(),before)
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),cipher)
        self.ok(self.lifecycle(['-e',A],data='\n'))
        # Unverified endpoint edits are abandoned on explicit quit, not resumed.
        self.assertIn(b'Host imap.example.invalid',self.read('.mbsyncrc'))

    def test_lifecycle_smtp_blocked(self):
        self.ok(self.runmw()); reader=self.home/'.config/mutt/muttrc'
        with reader.open('a') as out: out.write('set smtp_url="smtps://foreign.invalid"\n')
        before=self.configs()
        self.failed(self.lifecycle(['-D',A],data=''))
        self.assertEqual(self.configs(),before)
        self.assertFalse((self.pending/'published-account').exists())

    def test_lifecycle_foreign_reference_refused(self):
        self.ok(self.runmw()); reader=self.home/'.config/mutt/muttrc'
        with reader.open('a') as out: out.write('macro pager zz "<enter-command>source '+str(self.home/'.config/mutt/accounts'/(A+'.muttrc'))+'<enter>"\n')
        before=self.configs()
        self.failed(self.lifecycle(['-D',A],data=''))
        self.assertEqual(self.configs(),before)

    def test_lifecycle_tenth_default_remove_aliases(self):
        self.test_tenth_account_selector()
        reader=self.home/'.config/mutt/muttrc'
        reader.write_text(reader.read_text().replace('i1<Enter> ', 'i1<eNtEr> ').replace('i2<Enter> ', '"i2^J" '))
        tenth='account10@example.invalid'
        self.ok(self.lifecycle(['-R',tenth]))
        self.assertIn('i1<eNtEr>',reader.read_text()); self.assertIn('"i2^J"',reader.read_text())
        self.ok(self.lifecycle(['-D',tenth],data=''))
        self.assertNotIn('i10<Enter>',reader.read_text()); self.assertIn('"i2^J"',reader.read_text())
        self.assertIn('source "'+str(self.home/'.config/mutt/accounts/account1@example.invalid.muttrc')+'"',reader.read_text())

    def test_lifecycle_cancel_and_no_credential_access(self):
        self.ok(self.runmw()); self.ok(self.runmw(B))
        before=self.configs(); calls=self.home/'calls'; calls.unlink()
        self.failed(self.lifecycle(['-R',B],data='no\n'))
        self.assertFalse(self.pending.exists()); self.assertEqual(self.configs(),before)
        self.ok(self.lifecycle(['-R',B])); self.ok(self.lifecycle(['-D',A],data=''))
        for name,args,store in map(json.loads,calls.read_text().splitlines()):
            self.assertNotIn(name,['curl','pass'])

    def test_lifecycle_unknown_unsafe_and_foreign_blocks(self):
        self.ok(self.runmw()); before=self.configs()
        self.failed(self.lifecycle(['-e','unknown@example.invalid']))
        self.failed(self.lifecycle(['-R','unknown@example.invalid']))
        self.assertEqual(self.configs(),before); self.assertFalse(self.pending.exists())
        reader=self.home/'.config/mutt/muttrc'
        with reader.open('a') as out: out.write('# mw account begin foreign@example.invalid\n# foreign bytes\n# mw account end foreign@example.invalid\n')
        changed=self.configs(); (self.home/'calls').unlink()
        self.failed(self.lifecycle(['-D',A],data=''))
        self.assertEqual(self.configs(),changed)
        self.assertNotIn('neomutt',(self.home/'calls').read_text() if (self.home/'calls').exists() else '')

    def test_lifecycle_middle_preserves_other_default(self):
        c='carol@example.invalid'
        for email in [A,B,c]: self.ok(self.runmw(email))
        self.ok(self.lifecycle(['-R',c]))
        reader=self.home/'.config/mutt/muttrc'
        self.ok(self.lifecycle(['-D',B],data=''))
        self.assertIn('source "'+str(self.home/'.config/mutt/accounts'/(c+'.muttrc'))+'"',reader.read_text())
        self.assertIn('i1<Enter>',reader.read_text()); self.assertIn('i3<Enter>',reader.read_text())
        self.assertNotIn(B,reader.read_text())

    def test_lifecycle_last_failure_resume(self):
        self.ok(self.runmw()); before=self.configs()
        self.failed(self.lifecycle(['-D',A],data='quit\n',fault='lifecycle-reader-after-error'))
        self.assertEqual(self.configs(),before)
        self.ok(self.lifecycle(['-D',A],data='yes\n'))
        self.assertNotIn(b'source ',self.read('.config/mutt/muttrc'))
        self.assertEqual(self.show(A),SECRET+'\n')

    def test_lifecycle_remove_marker_failure(self):
        self.ok(self.runmw()); before=self.configs()
        self.failed(self.lifecycle(['-D',A],data='quit\n',fault='marker'))
        self.assertEqual(self.configs(),before)
        self.ok(self.lifecycle(['-D',A],data='yes\n'))

    def lifecycle_committed_failure(self,fault):
        self.ok(self.runmw()); self.ok(self.runmw(B))
        self.failed(self.lifecycle(['-D',A],data='',fault=fault))
        self.assertTrue((self.pending/'committed').is_file())
        self.assertFalse((self.home/'.config/mutt/accounts'/(A+'.muttrc')).exists())
        self.assertEqual((self.pending/'published-account').read_text(),'absent\n')
        self.ok(self.lifecycle(['-R',B]))
        self.assertFalse(self.pending.exists()); self.assertEqual(self.show(A),SECRET+'\n')

    def test_lifecycle_remove_postcommit_phase_failure(self): self.lifecycle_committed_failure('complete-write')
    def test_lifecycle_remove_postcommit_archive_failure(self): self.lifecycle_committed_failure('archive-after-commit')

    def test_lifecycle_remove_foreign_account_conflict(self):
        self.ok(self.runmw()); cipher=(self.store/(A+'.gpg')).read_bytes()
        self.failed(self.lifecycle(['-D',A],data='',fault='removed-account-conflict'))
        account=self.home/'.config/mutt/accounts'/(A+'.muttrc')
        self.assertEqual(account.read_text(),'# foreign account edit after removal\n')
        self.assertTrue((self.pending/'published-account').is_file())
        tomb=Path((self.pending/'removed-account').read_text().strip()); self.assertTrue(tomb.is_file())
        self.failed(self.lifecycle(['-D',A],data='yes\n'))
        self.assertEqual(account.read_text(),'# foreign account edit after removal\n')
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),cipher)

    def test_lifecycle_remove_symlink_refusal(self):
        self.ok(self.runmw()); account=self.home/'.config/mutt/accounts'/(A+'.muttrc')
        foreign=self.home/'foreign-config'; account.rename(foreign); before=foreign.read_bytes(); account.symlink_to(foreign)
        self.failed(self.lifecycle(['-D',A],data=''))
        self.assertTrue(account.is_symlink()); self.assertEqual(foreign.read_bytes(),before)
        self.assertFalse(self.pending.exists())

    def test_lifecycle_edit_missing_pass_no_repair(self):
        self.ok(self.runmw()); cipher=self.store/(A+'.gpg'); cipher.rename(self.store/'preserved.gpg')
        before=self.configs(); (self.home/'calls').unlink()
        self.failed(self.lifecycle(['-e',A,'-n','No Repair']))
        self.assertFalse(cipher.exists()); self.assertEqual(self.configs(),before)
        calls=(self.home/'calls').read_text(); self.assertNotIn('"pass"',calls)

    def test_lifecycle_remove_unsafe_reader_no_evaluation(self):
        self.ok(self.runmw()); reader=self.home/'.config/mutt/muttrc'
        with reader.open('a') as out: out.write('startup-hook "`touch '+str(self.home/'executed')+'`"\n')
        before=self.configs(); (self.home/'calls').unlink()
        self.failed(self.lifecycle(['-D',A],data=''))
        self.assertEqual(self.configs(),before); self.assertFalse((self.home/'executed').exists())
        calls=[json.loads(line)[0] for line in (self.home/'calls').read_text().splitlines()]
        self.assertTrue(all(name == 'ln' for name in calls))

    def test_lifecycle_writer_lock(self):
        self.ok(self.runmw()); (self.home/'calls').unlink()
        lock=self.home/'.config/mutt/.mw-active'; lock.mkdir(); (lock/'pid').write_text('fixture active writer\n')
        before=self.configs()
        self.failed(self.lifecycle(['-D',A],data=''))
        self.assertEqual(self.configs(),before); self.assertTrue(lock.is_dir())
        calls=[json.loads(line)[0] for line in (self.home/'calls').read_text().splitlines()]
        self.assertTrue(all(name == 'ln' for name in calls))

    def test_lifecycle_default_retry(self):
        self.ok(self.runmw()); self.ok(self.runmw(B)); before=self.configs()
        self.failed(self.lifecycle(['-R',B],data='yes\nquit\n',fault='lifecycle-reader-after-error'))
        self.assertEqual(self.configs(),before)
        self.ok(self.lifecycle(['-R',B],data='yes\n'))
        self.assertIn(('source "'+str(self.home/'.config/mutt/accounts'/(B+'.muttrc'))+'"').encode(),self.read('.config/mutt/muttrc'))

    def lifecycle_failure(self,op,phase,timing):
        self.ok(self.runmw()); self.ok(self.runmw(B))
        before=self.configs(); cipher=(self.store/(A+'.gpg')).read_bytes()
        args=['-D',A] if op=='remove' else ['-e',A,'-n','Alice Updated']
        data='' if op=='remove' else 'yes\nquit\n'
        self.failed(self.lifecycle(args,data=data,fault='lifecycle-'+phase+'-'+timing))
        self.assertEqual(self.configs(),before)
        self.assertFalse((self.pending/'committed').exists())
        if op=='remove': self.ok(self.lifecycle(args,data='yes\n'))
        else: self.ok(self.lifecycle(['-e',A],data='\n'))
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),cipher)
        self.assertFalse(self.pending.exists())

    def test_lifecycle_remove_committed_ctrl_c(self): self.lifecycle_interrupt('remove','committed')

    def lifecycle_interrupt(self,op,phase):
        self.ok(self.runmw()); self.ok(self.runmw(B))
        before=self.configs()
        args=['-D',A] if op=='remove' else ['-e',A,'-n','Alice Updated']
        pid,fd=pty.fork()
        fault='committed-block' if phase=='committed' else 'lifecycle-'+phase+'-block'
        if pid==0: os.execve(str(self.candidate),[str(self.candidate),*args],dict(self.env,FAULT=fault))
        status=None; interrupted=False; sent=False; transcript=b''
        try:
            end=time.monotonic()+60
            while time.monotonic()<end:
                if select.select([fd],[],[],.05)[0]:
                    try: transcript+=os.read(fd,8192)
                    except OSError: pass
                if b'Use this server?' in transcript and not sent: os.write(fd,b'\n'); sent=True
                if (self.home/'blocked').exists() and not interrupted: os.write(fd,b'\x03'); interrupted=True
                got,st=os.waitpid(pid,os.WNOHANG)
                if got: status=st; break
            self.assertIsNotNone(status,transcript.decode(errors='replace')); self.assertTrue(interrupted)
            self.assertNotEqual(os.waitstatus_to_exitcode(status),0)
        finally:
            if status is None: os.killpg(pid,signal.SIGKILL); os.waitpid(pid,0)
            os.close(fd)
        if phase=='committed':
            self.assertTrue((self.pending/'committed').is_file())
            self.assertFalse((self.home/'.config/mutt/accounts'/(A+'.muttrc')).exists())
            self.ok(self.lifecycle(['-R',B]))
            self.assertFalse(self.pending.exists()); self.assertEqual(self.show(A),SECRET+'\n')
            return
        self.assertEqual(self.configs(),before)
        self.ok(self.lifecycle(args,data='yes\n' if op=='remove' else '\n'))
        self.assertFalse(self.pending.exists())

    def test_reuse_never_overwritten(self):
        self.native(['pass','insert','-m',A],SECRET+'\nmetadata: preserved\n')
        # Native pass can return success despite the deliberately failing hook;
        # recapture changed index: the wizard, not this setup, must preserve it.
        self.before=self.git_snapshot()
        ciphertext=(self.store/(A+'.gpg')).read_bytes()
        (self.home/'hook-ran').unlink(missing_ok=True)
        self.ok(self.runmw(data='yes\n'))
        self.assertEqual((self.store/(A+'.gpg')).read_bytes(),ciphertext)

    def interrupt(self,fault):
        pid,fd=pty.fork()
        if pid==0:
            os.execve(str(self.candidate),[str(self.candidate),'-a',A,'-i','imap.example.invalid'],dict(self.env,FAULT=fault))
        transcript=b''; status=None; interrupted=False; sent=False; sent_password=False
        try:
            end=time.monotonic()+60
            while time.monotonic()<end:
                if select.select([fd],[],[],.05)[0]:
                    try: transcript+=os.read(fd,8192)
                    except OSError: pass
                if b'Use this server?' in transcript and not sent:
                    # Disable terminal echo before supplying fixture-only secret.
                    import termios
                    attrs=termios.tcgetattr(fd); attrs[3]&=~termios.ECHO; termios.tcsetattr(fd,termios.TCSANOW,attrs)
                    os.write(fd,b'yes\n'); sent=True
                if b'App password: ' in transcript and not sent_password:
                    os.write(fd,(SECRET+'\n').encode()); sent_password=True
                if (self.home/'blocked').exists() and not interrupted:
                    os.write(fd,b'\x03'); interrupted=True
                got,st=os.waitpid(pid,os.WNOHANG)
                if got: status=st; break
            while select.select([fd],[],[],.01)[0]:
                try: chunk=os.read(fd,8192)
                except OSError: break
                if not chunk: break
                transcript+=chunk
            self.assertIsNotNone(status,transcript.decode(errors='replace'))
            self.assertTrue(interrupted)
            self.assertNotEqual(os.waitstatus_to_exitcode(status),0)
            self.assertNotIn(SECRET.encode(),transcript)
            self.assertTrue((self.pending/'record').is_file())
            self.assertEqual(self.before,self.git_snapshot())
            self.assertFalse((self.home/'hook-ran').exists())
        finally:
            if status is None: os.killpg(pid,signal.SIGKILL); os.waitpid(pid,0)
            os.close(fd)
        if fault=='committed-block':
            self.assertTrue((self.pending/'committed').is_file())
            self.assertIn(b'committed; housekeeping/INBOX initialization may be pending',transcript)
            self.assertIn(b'no rollback',transcript)
            self.assertEqual((self.pending/'record').read_text().splitlines()[10],'config-pending')
            for key in ['muttrc','mbsyncrc','smtp-draft.txt','account']:
                self.assertTrue((self.pending/('published-'+key)).is_file())
                self.assertFalse((self.pending/('restored-'+key)).exists())
            self.ok(self.runmw(B))
            self.assertFalse(self.pending.exists())
            self.assertEqual(self.show(A),SECRET+'\n')
            return
        data='yes\n'+('' if (self.store/(A+'.gpg')).exists() else SECRET+'\n')
        self.ok(self.runmw(data=data))
        self.assertEqual(self.show(A),SECRET+'\n')

    def test_effective_suffix_smtp_refusal(self):
        self.ok(self.runmw())
        reader=self.home/'.config/mutt/muttrc'
        with reader.open('a') as out:
            out.write('\nset smtp_url="smtps://fixture.invalid"\nset smtp_pass="foreign"\n')
        before=reader.read_bytes()
        self.failed(self.runmw(B,data='yes\n'+SECRET+'\nquit\n'))
        self.assertEqual(reader.read_bytes(),before)
        self.assertFalse((self.home/'.config/mutt/accounts'/(B+'.muttrc')).exists())
        self.assertEqual(self.show(B),SECRET+'\n')
        self.assertIn('credential-saved',(self.pending/'record').read_text())

    def test_static_whitelist_no_evaluation(self):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        probe=self.home/'probe'
        for ws in [' ', '\t', '\v', '\f', '\r', ' \t']:
            for command in ['source', 'ifdef', 'ifndef', 'eval', 'push', 'exec',
                            'folder-hook', 'account-hook', 'startup-hook', 'unknown-command', 'macro', 'bind']:
                text=command+ws+'"`touch '+str(probe)+'`"\n'
                reader.write_text(text)
                (self.home/'calls').unlink(missing_ok=True)
                self.failed(self.runmw())
                self.assertEqual(reader.read_bytes(),text.encode())
                self.assertFalse(probe.exists())
                calls=(self.home/'calls').read_text() if (self.home/'calls').exists() else ''
                self.assertNotIn('neomutt',calls)
                self.assertFalse(self.pending.exists())
            # No backticks needed for refusal: unknown/indirect syntax alone.
            for command in ['source', 'ifdef', 'eval', 'folder-hook', 'unknown-command']:
                reader.write_text(command+ws+'"static"\n')
                (self.home/'calls').unlink(missing_ok=True)
                self.failed(self.runmw())
                calls=(self.home/'calls').read_text() if (self.home/'calls').exists() else ''
                self.assertNotIn('neomutt',calls)
            reader.write_text('set'+ws+'my_probe="`touch '+str(probe)+'`"\n')
            self.failed(self.runmw()); self.assertFalse(probe.exists())

        # A marker is not authorization to source unchecked files, including
        # traversal paths whose spelling merely matches a forged account ID.
        foreign=reader.parent/'foreign.muttrc'
        foreign.write_text('set my_probe="`touch '+str(probe)+'`"\n')
        reader.write_text('# mw account begin ../foreign\nsource "'+str(reader.parent/'accounts/../foreign.muttrc')+'"\n# mw account end ../foreign\n')
        before=reader.read_bytes(); (self.home/'calls').unlink(missing_ok=True)
        self.failed(self.runmw())
        self.assertEqual(reader.read_bytes(),before)
        self.assertFalse(probe.exists())
        calls=(self.home/'calls').read_text() if (self.home/'calls').exists() else ''
        self.assertNotIn('neomutt',calls)

    def whitespace_binding(self,ws,command):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        foreign=command+ws+'index,pager'+ws+'i1<Enter>'+ws+('"<noop>"' if command=='macro' else 'noop')+'\n'
        reader.write_text(foreign)
        p=self.runmw(data='yes\n'+SECRET+'\nquit\n')
        self.assertTrue(reader.read_bytes().startswith(foreign.encode()))
        if p.returncode==0:
            self.assertIn('macro index,pager i2<Enter> ',reader.read_text())
        else:
            # Even native-parser refusal must reserve the key in staged output.
            self.assertIn('macro index,pager i2<Enter> ',(self.pending/'muttrc').read_text())

    def selector_key(self,key,menus,command='macro'):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        foreign='\t'+command+'\t'+menus+'\v'+key+'\f'+('"<noop>"' if command=='macro' else 'noop')+'\n'
        reader.write_text(foreign)
        p=self.runmw(data='yes\n'+SECRET+'\nquit\n')
        self.assertTrue(reader.read_bytes().startswith(foreign.encode()))
        output=reader if p.returncode==0 else self.pending/'muttrc'
        self.assertIn('macro index,pager i2<Enter> ',output.read_text())
        self.assertNotIn('macro index,pager i1<Enter> ',output.read_text()[len(foreign):])

    def test_selector_unsupported_keys_no_evaluation(self):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        for key in ['"i1\\n"', '"i1\\r"', '"i1\\012"', '"i1\\x0a"',
                    '"i1\\q"', '"i1<unknown>"', '"i1^j"', '"i1^"',
                    '"i1<enter"', '"i1<Enter>>"', '"i1,i2"', '"i1 key"']:
            with self.subTest(key=key):
                foreign='macro "pager,index" '+key+' "<noop>"\n'
                reader.write_text(foreign); (self.home/'calls').unlink(missing_ok=True)
                p=self.runmw(); self.failed(p)
                self.assertIn('nothing evaluated',p.stdout+p.stderr)
                self.assertEqual(reader.read_text(),foreign)
                calls=(self.home/'calls').read_text() if (self.home/'calls').exists() else ''
                self.assertNotIn('neomutt',calls)
                self.assertFalse(self.pending.exists())

    def test_selector_generic_menu_fallback(self):
        self.selector_key('i1<Enter>', 'generic', 'bind')

    def test_selector_plain_ascii_other_menu(self):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        foreign='macro index,pager xyz "<noop>"\nbind browser i1<Enter> noop\n'
        reader.write_text(foreign)
        self.ok(self.runmw())
        self.assertTrue(reader.read_text().startswith(foreign))
        self.assertIn('macro index,pager i1<Enter> ',reader.read_text())

    def test_postcommit_failures_resume_next_account(self):
        for fault in ['complete-write','archive-after-commit']:
            with self.subTest(fault=fault):
                # Separate identity on each loop, with committed housekeeping
                # repaired by the next ordinary invocation (possibly B).
                email=A if fault=='complete-write' else 'carol@example.invalid'
                p=self.runmw(email,fault=fault)
                self.failed(p)
                self.assertIn('committed; housekeeping/INBOX initialization may be pending',p.stdout+p.stderr)
                self.assertIn('no rollback',p.stdout+p.stderr)
                self.assertEqual('config-pending' if fault=='complete-write' else 'complete',(self.pending/'record').read_text().splitlines()[10])
                self.assertTrue((self.pending/'committed').is_file())
                self.assertTrue((self.home/'.config/mutt/accounts'/(email+'.muttrc')).is_file())
                snapshots={k:self.read(k) for k in ['.mbsyncrc','.config/mutt/muttrc','.config/mutt/smtp-draft.txt']}
                for key in ['muttrc','mbsyncrc','smtp-draft.txt','account']:
                    self.assertTrue((self.pending/('published-'+key)).is_file())
                    self.assertFalse((self.pending/('restored-'+key)).exists())
                next_email=B if fault=='complete-write' else 'dave@example.invalid'
                self.ok(self.runmw(next_email))
                self.assertFalse(self.pending.exists())
                for k,v in snapshots.items(): self.assertTrue(self.read(k).startswith(v))
                self.assertEqual(self.show(email),SECRET+'\n')

    def init_interrupt(self,fault):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        reader.write_text('# snapshot seed\n')
        pid,fd=pty.fork()
        if pid==0:
            os.execve(str(self.candidate),[str(self.candidate),'-a',A,'-i','imap.example.invalid'],dict(self.env,FAULT=fault))
        status=None; interrupted=False
        try:
            end=time.monotonic()+60
            while time.monotonic()<end:
                if select.select([fd],[],[],.05)[0]:
                    try: os.read(fd,8192)
                    except OSError: pass
                if (self.home/'blocked').exists() and not interrupted:
                    self.assertEqual(self.pending.exists(),fault=='init-ready-block')
                    if fault=='init-ready-block':
                        self.assertTrue((self.pending/'record').is_file())
                        for key in ['muttrc','mbsyncrc','smtp-draft.txt','account']:
                            self.assertTrue((self.pending/('state-'+key)).is_file())
                            self.assertTrue((self.pending/('original-'+key)).is_file())
                    os.write(fd,b'\x03'); interrupted=True
                got,st=os.waitpid(pid,os.WNOHANG)
                if got: status=st; break
            self.assertIsNotNone(status); self.assertTrue(interrupted)
            self.assertNotEqual(os.waitstatus_to_exitcode(status),0)
        finally:
            if status is None: os.killpg(pid,signal.SIGKILL); os.waitpid(pid,0)
            os.close(fd)
        self.assertEqual(self.pending.exists(),fault=='init-ready-block')
        self.assertEqual(list((self.home/'.config/mutt').glob('.mw-init.*')),[])
        if fault!='init-ready-block': self.assertEqual(list(self.home.glob('.mw-credential.*')),[])
        self.ok(self.runmw(data='yes\n'+SECRET+'\n' if fault=='init-ready-block' else None))
        self.assertEqual(self.show(A),SECRET+'\n')

    def test_ctrl_c_initial_record(self): self.init_interrupt('init-before-record-block')
    def test_ctrl_c_initial_snapshot(self): self.init_interrupt('init-snapshot-block')
    def test_ctrl_c_ready_publication(self): self.init_interrupt('init-ready-block')
    def test_initial_snapshot_error(self):
        reader=self.home/'.config/mutt/muttrc'; reader.parent.mkdir(parents=True)
        reader.write_text('# snapshot seed\n')
        self.failed(self.runmw(fault='init-snapshot-error'))
        self.assertFalse(self.pending.exists())
        self.assertEqual(list((self.home/'.config/mutt').glob('.mw-init.*')),[])
        self.assertEqual(list(self.home.glob('.mw-credential.*')),[])
        self.ok(self.runmw())

    def test_ctrl_c_committed_marker(self): self.interrupt('committed-block')
    def test_ctrl_c_insert(self): self.interrupt('insert-block')
    def test_ctrl_c_readback(self): self.interrupt('readback-block')
    def test_ctrl_c_link_phase_gap(self): self.interrupt('link-gap')
    def test_ctrl_c_publication(self): self.interrupt('publication-block')


for label,ws in [('space',' '),('tab','\t'),('vertical_tab','\v'),('formfeed','\f'),('carriage_return','\r'),('mixed',' \t')]:
    for command in ['macro','bind']:
        def whitespace_test(self,ws=ws,command=command): self.whitespace_binding(ws,command)
        setattr(Overlay,'test_whitespace_'+command+'_'+label,whitespace_test)

for label,key in [('lower_enter','i1<enter>'),('return','i1<return>'),
                  ('cr','i1<cr>'),('upper','i1<ENTER>'),('mixed','i1<eNtEr>'),
                  ('mixed_return','i1<ReTuRn>'),('upper_cr','i1<CR>'),
                  ('caret_j','"i1^J"'),('caret_m',"'i1^M'"),
                  ('nonenter_suffix','i1xyz')]:
    for command,menus in [('macro','"pager,index"'),('bind',"'pager'"),('macro','index')]:
        def key_test(self,key=key,menus=menus,command=command): self.selector_key(key,menus,command)
        setattr(Overlay,'test_selector_'+label+'_'+command+'_'+menus.replace('"','').replace("'",'').replace(',','_'),key_test)

for op,phases in [('remove',['delete','sync','draft','reader']),('edit',['account','sync','draft','reader'])]:
    for phase in phases:
        for timing in ['before-error','after-error']:
            def failure_test(self,op=op,phase=phase,timing=timing): self.lifecycle_failure(op,phase,timing)
            setattr(Overlay,'test_lifecycle_'+op+'_'+phase+'_'+timing.replace('-','_'),failure_test)
        def interrupt_test(self,op=op,phase=phase): self.lifecycle_interrupt(op,phase)
        setattr(Overlay,'test_lifecycle_'+op+'_'+phase+'_ctrl_c',interrupt_test)

for label,relative,setting in [('reader','.config/mutt/muttrc',b'set sort = date'),
                               ('sync','.mbsyncrc',b'FSync yes'),
                               ('draft','.config/mutt/smtp-draft.txt',b'tls on'),
                               ('account','.config/mutt/accounts/'+B+'.muttrc',b'set sort = date')]:
    for kind,suffix in [('comment',b'# foreign EOF without newline'),('setting',setting)]:
        def eof_test(self,relative=relative,suffix=suffix): self.eof_refusal(relative,suffix)
        setattr(Overlay,'test_lifecycle_eof_'+label+'_'+kind,eof_test)

if __name__=='__main__': unittest.main()
