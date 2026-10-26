const $ = (s) => document.querySelector(s);
const state = { user: null, chatId: null, chats: [], authMode: "login", recognition: null };
const conversation = $("#conversation"), welcome = $("#welcome"), promptBox = $("#prompt"), historyBox = $("#history");
function toast(message, bad=false) { const el=$("#toast"); el.textContent=message; el.classList.toggle("bad",bad); el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"),4200); }
async function api(url, options={}) {
  const response = await fetch(url, { credentials:"same-origin", headers:{"Content-Type":"application/json",...(options.headers||{})}, ...options });
  const data = await response.json().catch(()=>({error:"Unexpected server response."}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function showModal(mode="login") { $("#authModal").classList.remove("hidden"); setAuthMode(mode); }
function setAuthMode(mode) {
  state.authMode=mode;
  document.querySelectorAll("[data-auth]").forEach(b=>b.classList.toggle("selected",b.dataset.auth===mode));
  $("#nameWrap").classList.toggle("hidden",mode!=="register");
  $("#authName").required=mode==="register";
  $("#authPassword").autocomplete=mode==="register"?"new-password":"current-password";
  $("#authSubmit").textContent=mode==="register"?"Create account":"Sign in";
  $("#authError").textContent="";
}
function renderAuth() {
  $("#authBox").innerHTML = state.user
    ? `<div class="user-card"><strong>${escapeHtml(state.user.name)}</strong><small>${escapeHtml(state.user.email)}</small></div>`
    : `<button class="primary full" id="openAuth">Sign in / Create account</button>`;
  const open=$("#openAuth"); if(open) open.onclick=()=>showModal("login");
  $("#logout").classList.toggle("hidden",!state.user);
  $("#newChat").disabled=!state.user;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function linkify(text) {
  const escaped=escapeHtml(text);
  return escaped.replace(/https?:\/\/[^\s<]+/g, u=>`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
function addMessage(role, text) {
  welcome.classList.add("hidden"); conversation.classList.remove("hidden");
  const row=document.createElement("div"); row.className="message "+(role==="user"?"user":"");
  const avatar=document.createElement("div"); avatar.className="avatar"; avatar.textContent=role==="user"?"☺":"✦";
  const bubble=document.createElement("div"); bubble.className="bubble"; bubble.innerHTML=linkify(text);
  row.append(avatar,bubble); conversation.append(row); conversation.scrollTop=conversation.scrollHeight; return bubble;
}
function resetConversation() { state.chatId=null; conversation.replaceChildren(); conversation.classList.add("hidden"); welcome.classList.remove("hidden"); $("#imageArea").replaceChildren(); $("#imageArea").classList.add("hidden"); historyBox.querySelectorAll(".history-item").forEach(x=>x.classList.remove("active")); }
async function refreshChats() {
  if(!state.user) { historyBox.replaceChildren(); return; }
  const data=await api("/api/chats"); state.chats=data.chats; historyBox.replaceChildren();
  for(const chat of state.chats) {
    const btn=document.createElement("button"); btn.className="history-item"+(chat.id===state.chatId?" active":""); btn.textContent=chat.title; btn.title=chat.title;
    btn.onclick=()=>loadChat(chat.id); btn.oncontextmenu=async e=>{e.preventDefault();if(confirm("Delete this chat and its messages?")){try{await api(`/api/chats/${chat.id}`,{method:"DELETE"});if(state.chatId===chat.id)resetConversation();await refreshChats()}catch(err){toast(err.message,true)}}};
    historyBox.append(btn);
  }
}
async function loadChat(id) {
  try { const data=await api(`/api/chats/${id}/messages`); state.chatId=id; conversation.replaceChildren(); welcome.classList.add("hidden");conversation.classList.remove("hidden");data.messages.forEach(m=>addMessage(m.role,m.content));await refreshChats(); }
  catch(e){toast(e.message,true)}
}
async function ensureAuth(){if(!state.user){showModal("login");throw new Error("Please sign in to use AI Fusion.");}}
async function sendMessage(text=promptBox.value.trim()) {
  if(!text.trim())return;
  try{await ensureAuth()}catch(e){toast(e.message,true);return}
  promptBox.value=""; promptBox.style.height="42px";
  addMessage("user",text); const loading=addMessage("assistant","Thinking…");
  $("#send").disabled=true;
  try {
    const data=await api("/api/chat",{method:"POST",body:JSON.stringify({message:text,chatId:state.chatId,mode:$("#mode").value})});
    state.chatId=data.chatId; loading.textContent=data.reply; await refreshChats();
  } catch(e){loading.textContent=e.message;toast(e.message,true)}
  finally{$("#send").disabled=false;promptBox.focus()}
}
$("#composer").addEventListener("submit",e=>{e.preventDefault();sendMessage()});
promptBox.addEventListener("input",()=>{promptBox.style.height="auto";promptBox.style.height=Math.min(promptBox.scrollHeight,180)+"px"});
promptBox.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()}});
$("#newChat").onclick=resetConversation;
$("#closeAuth").onclick=()=>$("#authModal").classList.add("hidden");
$("#authModal").addEventListener("click",e=>{if(e.target.id==="authModal")$("#authModal").classList.add("hidden")});
document.querySelectorAll("[data-auth]").forEach(b=>b.onclick=()=>setAuthMode(b.dataset.auth));
$("#openAuth").onclick=()=>showModal("login");
$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault();const mode=state.authMode;
  const body={email:$("#authEmail").value,password:$("#authPassword").value};
  if(mode==="register")body.name=$("#authName").value;
  try{const data=await api(`/api/${mode}`,{method:"POST",body:JSON.stringify(body)});state.user=data.user;$("#authModal").classList.add("hidden");renderAuth();await refreshChats();toast(mode==="register"?"Account created. Welcome!":"Signed in successfully.");}
  catch(err){$("#authError").textContent=err.message}
});
$("#logout").onclick=async()=>{try{await api("/api/logout",{method:"POST",body:"{}"});state.user=null;state.chatId=null;renderAuth();resetConversation();await refreshChats();toast("Signed out.");}catch(e){toast(e.message,true)}};
document.querySelectorAll("[data-prompt]").forEach(b=>b.onclick=()=>{if(b.dataset.mode)$("#mode").value=b.dataset.mode;promptBox.value=b.dataset.prompt;promptBox.focus();});
$("#codeQuick").onclick=()=>{$("#mode").value="code";promptBox.focus();promptBox.placeholder="Describe the code you need or paste code to debug…"};
$("#searchQuick").onclick=()=>{$("#mode").value="search";promptBox.focus();promptBox.placeholder="What should I search the web for?";};
$("#imageQuick").onclick=()=>imagePrompt();$("#imageFeature").onclick=()=>imagePrompt();
async function imagePrompt(){
  try{await ensureAuth()}catch(e){toast(e.message,true);return}
  const p=prompt("Describe the image you want to generate:");if(!p?.trim())return;
  const area=$("#imageArea");area.classList.remove("hidden");area.replaceChildren();const wait=document.createElement("p");wait.textContent="Creating your image… this may take a little while.";area.append(wait);
  try{const data=await api("/api/image",{method:"POST",body:JSON.stringify({prompt:p.trim()})});area.replaceChildren();const img=document.createElement("img");img.src=data.image;img.alt=p;area.append(img);toast("Image generated.");}
  catch(e){area.replaceChildren();toast(e.message,true)}
}
function setupSpeech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){toast("Voice input is not supported in this browser. Try Chrome or Edge.",true);return}
  if(state.recognition){state.recognition.stop();state.recognition=null;$("#mic").textContent="🎙";return}
  const rec=new SR();state.recognition=rec;rec.lang="en-IN";rec.interimResults=false;rec.maxAlternatives=1;
  $("#mic").textContent="🔴";rec.onresult=e=>{promptBox.value+=(promptBox.value?" ":"")+e.results[0][0].transcript;promptBox.dispatchEvent(new Event("input"))};
  rec.onerror=()=>toast("Voice input failed. Check microphone permission.",true);
  rec.onend=()=>{$("#mic").textContent="🎙";state.recognition=null};rec.start();
}
$("#mic").onclick=setupSpeech;$("#voiceBtn").onclick=()=>{setupSpeech();promptBox.focus()};
async function init(){
  try{const d=await api("/api/me");state.user=d.user;renderAuth();if(state.user)await refreshChats();else showModal("login");}
  catch(e){toast("Could not connect to the server.",true)}
}
init();