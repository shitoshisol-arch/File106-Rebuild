(() => {
  const KEY = "file106-investigation-v1";
  const fresh = () => ({ symbol: false, code105: false, echo: false, final: false, log: [] });
  let state;
  try { state = { ...fresh(), ...(JSON.parse(localStorage.getItem(KEY) || "{}")) }; } catch { state = fresh(); }
  const $ = (id) => document.getElementById(id);
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));
  const toast = (msg) => { const el=$("toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2300); };
  const addLog = (message) => { if (!state.log.includes(message)) state.log.push(message); save(); render(); };
  const count = () => [state.symbol,state.code105,state.echo,state.final].filter(Boolean).length;
  const unlocked = (id) => id==="001" || (id==="105" && state.code105) || (id==="106" && state.symbol && state.echo) || (id==="107" && state.final);
  function render(){
    document.querySelectorAll(".file-row").forEach(row=>{
      const id=row.dataset.file, open=unlocked(id);
      row.disabled=!open; row.classList.toggle("locked",!open); row.classList.toggle("available",open);
      const status=row.querySelector(".file-status");
      status.innerHTML=open ? 'AVAILABLE <b>↗</b>' : 'LOCKED <b>⌑</b>';
      const sub=row.querySelector("small");
      if(id==="105") sub.textContent=state.code105?"Recovered fragment // opened":"Requires access code: 001";
      if(id==="106") sub.textContent=state.symbol&&state.echo?"Recovered fragment // opened":"Requires signature + FILE105";
      if(id==="107") sub.textContent=state.final?"Transmission recovered":"Requires final phrase";
    });
    $("fileCount").textContent=`${1+[state.code105,state.symbol&&state.echo,state.final].filter(Boolean).length} / 4 FILES RECOVERED`;
    $("progressText").textContent=`${count()} / 4`;
    $("progressBar").style.width=`${count()*25}%`;
    $("discoveryList").innerHTML=state.log.length ? state.log.map(x=>`<li>+ ${escapeHtml(x)}</li>`).join("") : '<li class="empty-log">No evidence recovered yet.</li>';
    if(state.final){$("answerInput").placeholder="ARCHIVE COMPLETE";$("answerInput").disabled=true;$("submitAnswer").disabled=true;$("answerFeedback").textContent="ALL CURRENT FRAGMENTS RECOVERED. THE ARCHIVE IS STILL ACTIVE.";}
    else if(state.echo){$("puzzle-prompt").textContent="The final transmission repeats the status of FILE106. Enter the two-word status phrase."; $("cipher").textContent="F I L E 1 0 6 :  S T I L L  A C T I V E"; $("answerInput").placeholder="ENTER STATUS PHRASE...";}
    else if(state.code105){$("puzzle-prompt").textContent="FILE105 contains one surviving word, repeated in the system log. Enter that word to recover the next transmission."; $("cipher").textContent="E C H O  /  E C H O  /  E C H O"; $("answerInput").placeholder="ENTER THE WORD...";}
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function inspectSymbol(){
    if(!state.symbol){state.symbol=true;addLog("EXHIBIT 8_* — signature inspected. Fragment: 105-08-*");}
    $("symbolFeedback").textContent="FRAGMENT RECOVERED: 105-08-*";
    $("symbolModal").hidden=false;
  }
  $("heroSymbol").addEventListener("click",inspectSymbol);
  $("heroSymbol").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();inspectSymbol();}});
  $("inspectSymbol").addEventListener("click",inspectSymbol);
  $("closeModal").addEventListener("click",()=>$("symbolModal").hidden=true);
  $("ackSymbol").addEventListener("click",()=>{$("symbolModal").hidden=true;toast("SIGNATURE ADDED TO INVESTIGATION LOG");});
  $("symbolModal").addEventListener("click",e=>{if(e.target===$("symbolModal"))$("symbolModal").hidden=true;});
  document.querySelectorAll(".file-row").forEach(row=>row.addEventListener("click",()=>{
    const id=row.dataset.file;if(!unlocked(id))return;
    const reader=$("fileReader"), content=$("readerContent");
    const docs={
      "001":`<p class="eyebrow">RECOVERED // FRAGMENT 001</p><h3>The First Signal</h3><p>The archive returned one intact line from a damaged index:</p><p class="reader-code">PROJECT_105</p><p>The number is not a date. It identifies the project that disappeared before FILE106 appeared.</p><p class="muted">Use the identifier in the investigation terminal. A correct answer will unlock the termination report.</p>`,
      "105":`<p class="eyebrow">RESTRICTED // TERMINATION REPORT</p><h3>Project105 — Final Record</h3><p>All operators removed from index. All local copies marked for deletion. The final process returned a single word before the system went dark:</p><p class="reader-code">E C H O</p><p>It appeared three times. No audio source was attached.</p><p class="muted">The archive has preserved the word. Enter it in the investigation terminal.</p>`,
      "106":`<p class="eyebrow">RECOVERED // ORIGIN UNKNOWN</p><h3>FILE106</h3><p>Creation event: <span class="red">NOT FOUND</span><br>Creator: <span class="red">NOT FOUND</span><br>Origin: <span class="red">NOT FOUND</span></p><p>The only readable status field survived the corruption:</p><p class="reader-code">STILL ACTIVE</p><p class="muted">The file does not explain what it means. It only repeats the status.</p>`,
      "107":`<p class="eyebrow">TRANSMISSION // 004</p><h3>The Archive Responds</h3><p>You recovered every currently available fragment.</p><p class="reader-code">YOU WERE NEVER SUPPOSED TO FIND THIS.</p><p>There are no further records in this release. The archive is waiting for the next transmission.</p><p class="muted">8_* // END OF CURRENT RECOVERY</p>`
    };
    $("readerId").textContent=`FILE_${id} // ${id==="001"?"RECOVERED":"ACCESS GRANTED"}`;
    content.innerHTML=docs[id];reader.hidden=false;reader.scrollIntoView({behavior:"smooth",block:"nearest"});
    addLog(`FILE_${id} opened`);
  }));
  $("closeReader").addEventListener("click",()=>$("fileReader").hidden=true);
  $("submitAnswer").addEventListener("click",submit);
  $("answerInput").addEventListener("keydown",e=>{if(e.key==="Enter")submit();});
  function submit(){
    const val=$("answerInput").value.trim().toLowerCase().replace(/\s+/g," ");
    if(!val){$("answerFeedback").textContent="INPUT REQUIRED.";return;}
    if(!state.code105 && val==="105"){state.code105=true;addLog("ACCESS CODE ACCEPTED — FILE105 unlocked");$("answerFeedback").textContent="ACCESS GRANTED. FILE105 IS NOW AVAILABLE.";toast("FILE105 UNLOCKED");}
    else if(state.code105&&!state.echo&&val==="echo"){state.echo=true;addLog("ECHO RECOVERED — FILE106 access conditions met");$("answerFeedback").textContent="SIGNAL DECODED. FILE106 IS NOW AVAILABLE.";toast("FILE106 UNLOCKED");}
    else if(state.echo&&!state.final&&val==="still active"){state.final=true;addLog("FINAL STATUS CONFIRMED — FILE107 unlocked");$("answerFeedback").textContent="TRANSMISSION RECOVERED. CURRENT ARCHIVE COMPLETE.";toast("FILE107 UNLOCKED");}
    else if(state.final){$("answerFeedback").textContent="CURRENT ARCHIVE ALREADY RECOVERED.";}
    else {$("answerFeedback").textContent="ACCESS DENIED. CHECK THE RECOVERED FRAGMENTS."; $("answerInput").select();}
    $("answerInput").value="";save();render();
  }
  $("hintToggle").addEventListener("click",()=>{const h=$("hintText");h.hidden=!h.hidden;$("hintToggle").textContent=h.hidden?"REQUEST HINT +":"HIDE HINT −";});
  $("resetProgress").addEventListener("click",()=>{if(!confirm("Erase this browser's FILE106 investigation progress?"))return;state=fresh();save();$("answerInput").disabled=false;$("submitAnswer").disabled=false;$("answerFeedback").textContent="AWAITING INPUT.";$("answerInput").placeholder="TYPE THE CODE...";$("symbolFeedback").textContent="OBJECT NOT YET INSPECTED.";$("fileReader").hidden=true;render();toast("LOCAL INVESTIGATION RESET");});
  document.querySelectorAll("[data-copy]").forEach(btn=>btn.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(btn.dataset.copy);toast("MINT ADDRESS COPIED");}catch{toast("COPY UNAVAILABLE — SELECT THE ADDRESS MANUALLY");}}));
  render();
})();