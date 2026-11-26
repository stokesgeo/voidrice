// OpenBSD theme writes $XDG_CACHE_HOME/theme after repainting terminal palettes.
// Watch that state, not terminal input: xterm's OSC setters emit no appearance event.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function watchDesktopTheme(file, apply, report) {
 let closed=false, parent, leaf, inode;
 const fail=error=>{if(!closed)report(error);};
 const reconcile=()=>{
  if(closed)return;
  try {
   const st=fs.statSync(file), key=`${st.dev}:${st.ino}`;
   if(key!==inode) {
    leaf?.close(); leaf=undefined; inode=undefined;
    leaf=fs.watch(file,reconcile);
    leaf.on('error',error=>{leaf?.close();leaf=undefined;inode=undefined;fail(error);});
    inode=key;
   }
   // A truncate/write can briefly be empty. Ignore it; the write event follows.
   const mode=fs.readFileSync(file,'utf8').trim();
   if(mode==='day'||mode==='night')apply(mode);
  } catch(error) {
   if(error.code!=='ENOENT')fail(error);
   else {leaf?.close();leaf=undefined;inode=undefined;}
  }
 };
 try {
  // Parent catches creation and atomic replacement; leaf catches in-place writes
  // on kqueue, where a directory watch alone does not report child-file writes.
  parent=fs.watch(path.dirname(file),(_event,name)=>{
   if(name===null||String(name)===path.basename(file))reconcile();
  });
  parent.on('error',fail);
 } catch(error) { fail(error); }
 reconcile();
 const ready=setImmediate(reconcile);
 return ()=>{closed=true;clearImmediate(ready);leaf?.close();parent?.close();};
}

export default function desktopTheme(pi) {
 let stop, unsubscribe;
 const close=()=>{unsubscribe?.();unsubscribe=undefined;stop?.();stop=undefined;};
 pi.on('session_start',(_event,ctx)=>{
  close();
  if(ctx.mode!=='tui')return;
  const automatic='vertrice-day/vertrice-night';
  // Read actual selection intent, not effective settings rebuilt by native saves
  // or the active member of the pair. No accessor means no automatic override.
  const selected=()=>ctx.ui.getThemeSelection?.()===automatic;
  // A fixed startup still needs the native selection listener, but no file watch.
  if(!ctx.ui.onThemeSelectionChange)return;
  let warned=false;
  const report=error=>{
   if(!warned){warned=true;ctx.ui.notify(`Desktop theme sync unavailable: ${error.message}`,'warning');}
  };
  const selectionChanged=()=>{
   stop?.();stop=undefined;
   if(!selected())return;
   let owned=false;
   stop=watchDesktopTheme(path.join(process.env.XDG_CACHE_HOME||path.join(os.homedir(),'.cache'),'theme'),mode=>{
   if(!selected())return;
   if(!['vertrice-day','vertrice-night'].includes(ctx.ui.theme.name))return;
   const name=`vertrice-${mode}`;
   // Entry must claim native in-memory ownership even for a matching name.
   if(owned&&ctx.ui.theme.name===name)return;
   const theme=ctx.ui.getTheme(name);
   if(!theme){report(new Error(`missing ${name}`));return;}
   // In-memory Theme objects do not persist preferences or change selection intent.
   const result=ctx.ui.setTheme(theme);
   if(!result.success)report(new Error(result.error));
   else owned=true;
   },report);
  };
  unsubscribe=ctx.ui.onThemeSelectionChange(selectionChanged);
  selectionChanged();
 });
 pi.on('session_shutdown',close);
}
