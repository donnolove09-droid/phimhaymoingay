const API='/api';
const TOKEN_KEY='phimhay_admin_token';
let token=localStorage.getItem(TOKEN_KEY)||'';
let movies=[];
let editingId=null;
const $=id=>document.getElementById(id);

function showLogin(){$('loginGate').classList.remove('hidden');$('adminApp').classList.add('hidden')}
function showApp(){$('loginGate').classList.add('hidden');$('adminApp').classList.remove('hidden');initAdmin()}

async function login(){
const username=$('username').value.trim();
const password=$('password').value;
$('loginError').textContent='';
$('loginBtn').disabled=true;
$('loginBtn').textContent='Đang đăng nhập...';
try{
const res=await fetch(`${API}/admin/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
const data=await res.json();
if(!res.ok)throw new Error(data.error||'Đăng nhập thất bại');
token=data.token;
localStorage.setItem(TOKEN_KEY,token);
showApp();
}catch(e){$('loginError').textContent=e.message}
finally{$('loginBtn').disabled=false;$('loginBtn').textContent='Đăng nhập'}
}

async function apiFetch(url,opts={}){
const res=await fetch(url,{...opts,headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json',...(opts.headers||{})}});
if(res.status===401){localStorage.removeItem(TOKEN_KEY);location.reload();throw new Error('Hết phiên')}
return res;
}

document.querySelectorAll('.tab').forEach(tab=>{
tab.addEventListener('click',e=>{e.preventDefault();switchView(tab.dataset.view)});
});

function switchView(view){
document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===view));
document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));
if(view==='movies')loadMovies();
if(view==='keys')loadKeyStats();
if(view==='orders')loadOrders();
if(view==='settings')loadSettings();
}

async function loadMovies(){
try{const res=await apiFetch(`${API}/custom/admin/all`);movies=await res.json();renderTable()}
catch(e){console.error(e)}
}

function renderTable(filter=''){
const tbody=$('moviesTable');
if(!tbody)return;
const list=filter?movies.filter(m=>m.title.toLowerCase().includes(filter.toLowerCase())):movies;
if(!list.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#9a9aa3;padding:40px">Chưa có phim</td></tr>';return}
tbody.innerHTML=list.map(m=>`<tr><td><img src="${m.poster||'https://via.placeholder.com/44x64/1c1c20/666'}"></td><td>${attr(m.title)}</td><td>${m.year||'—'}</td><td>${m.isSeries?`Bộ (${m.episodes?.length||0} tập)`:'Lẻ'}</td><td>${m.views||0}</td><td><button class="btn-mini btn-edit" onclick="editMovie('${m._id}')">Sửa</button><button class="btn-mini btn-del" onclick="deleteMovie('${m._id}')">Xóa</button></td></tr>`).join('');
}

if($('adminSearch'))$('adminSearch').addEventListener('input',e=>renderTable(e.target.value));

if($('movieForm'))$('movieForm').addEventListener('submit',async e=>{
e.preventDefault();
const payload={title:$('fTitle').value.trim(),slug:$('fSlug').value.trim(),year:Number($('fYear').value)||undefined,country:$('fCountry').value.trim(),genres:$('fGenres').value.split(',').map(s=>s.trim()).filter(Boolean),quality:$('fQuality').value,language:$('fLanguage').value,isSeries:$('fIsSeries').value==='true',poster:$('fPoster').value.trim(),backdrop:$('fBackdrop').value.trim(),description:$('fDescription').value.trim(),videoType:$('fVideoType').value,videoUrl:$('fVideoUrl').value.trim(),episodes:collectEpisodes()};
try{
const url=editingId?`${API}/custom/admin/${editingId}`:`${API}/custom/admin`;
const method=editingId?'PUT':'POST';
const res=await apiFetch(url,{method,body:JSON.stringify(payload)});
if(!res.ok){const err=await res.json();throw new Error(err.error||'Lỗi lưu')}
alert(editingId?'Cập nhật thành công':'Thêm phim thành công');
resetForm();
switchView('movies');
}catch(e){alert(e.message)}
});

function collectEpisodes(){
const episodes=[];
document.querySelectorAll('.episode-row').forEach(row=>{
const name=row.querySelector('.ep-name').value.trim();
const url=row.querySelector('.ep-main').value.trim();
const embed=row.querySelector('.ep-alt').value.trim();
// Server tự nhận diện m3u8 / mp4 / embed từ link
if(url||embed)episodes.push({name:name||`Tập ${episodes.length+1}`,url,embed});
});
return episodes;
}

if($('addEpisode'))$('addEpisode').addEventListener('click',()=>addEpisodeRow());

function attr(v){return String(v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}
function addEpisodeRow(data={}){
const editor=$('episodesEditor');
const row=document.createElement('div');
row.className='episode-row';
const main=data.m3u8||data.mp4||data.embed||'';
const alt=(data.m3u8||data.mp4)?(data.embed||''):'';
row.innerHTML=`<input class="ep-name" placeholder="Tên tập" value="${attr(data.name)}"><input class="ep-main" placeholder="Link phát (m3u8 / mp4 / embed)" value="${attr(main)}"><input class="ep-alt" placeholder="Link dự phòng (embed, tuỳ chọn)" value="${attr(alt)}"><button type="button" class="remove-ep">&times;</button>`;
row.querySelector('.remove-ep').onclick=()=>row.remove();
editor.appendChild(row);
}

function resetForm(){
editingId=null;
if($('movieForm'))$('movieForm').reset();
if($('editId'))$('editId').value='';
if($('episodesEditor'))$('episodesEditor').innerHTML='';
if($('formTitle'))$('formTitle').textContent='Thêm phim mới';
}

if($('resetForm'))$('resetForm').addEventListener('click',resetForm);
if($('cancelEdit'))$('cancelEdit').addEventListener('click',()=>{resetForm();switchView('movies')});

function editMovie(id){
const m=movies.find(x=>x._id===id);if(!m)return;
editingId=id;$('formTitle').textContent='Chỉnh sửa phim';
$('fTitle').value=m.title||'';$('fSlug').value=m.slug||'';$('fYear').value=m.year||'';$('fCountry').value=m.country||'';$('fGenres').value=(m.genres||[]).join(', ');$('fQuality').value=m.quality||'HD';$('fLanguage').value=m.language||'Vietsub';$('fIsSeries').value=String(m.isSeries||false);$('fPoster').value=m.poster||'';$('fBackdrop').value=m.backdrop||'';$('fDescription').value=m.description||'';$('fVideoType').value=m.videoType||'iframe';$('fVideoUrl').value=m.videoUrl||'';
$('episodesEditor').innerHTML='';(m.episodes||[]).forEach(ep=>addEpisodeRow(ep));
switchView('add');
}

async function deleteMovie(id){
if(!confirm('Xóa phim này?'))return;
try{const res=await apiFetch(`${API}/custom/admin/${id}`,{method:'DELETE'});if(!res.ok)throw new Error('Lỗi xóa');loadMovies()}catch(e){alert(e.message)}
}

async function loadKeyStats(){
try{
const[stats,used]=await Promise.all([apiFetch(`${API}/admin/keys/stats`).then(r=>r.json()),apiFetch(`${API}/admin/keys/used`).then(r=>r.json())]);
const ks=$('keyStats');
if(ks)ks.innerHTML=`<div class="stat-card"><div class="label">Tổng</div><div class="value">${stats.total}</div></div><div class="stat-card"><div class="label">Chưa dùng</div><div class="value">${stats.unused}</div></div><div class="stat-card"><div class="label">Đã dùng</div><div class="value">${stats.used}</div></div><div class="stat-card"><div class="label">Đang active</div><div class="value">${stats.active}</div></div>`;
const tb=$('usedKeysTable');
if(tb){
if(!used.length){tb.innerHTML='<tr><td colspan="4" style="text-align:center;color:#9a9aa3;padding:20px">Chưa có key dùng</td></tr>'}
else{tb.innerHTML=used.map(k=>`<tr><td style="font-family:monospace;font-size:12px">${k.key}</td><td>${k.usedAt?new Date(k.usedAt).toLocaleString('vi-VN'):'—'}</td><td>${k.expiresAt?new Date(k.expiresAt).toLocaleString('vi-VN'):'—'}</td><td style="font-size:12px;color:#9a9aa3">${k.usedBy?.ip||'—'}</td></tr>`).join('')}
}
}catch(e){console.error(e)}
}

if($('refreshKeys'))$('refreshKeys').addEventListener('click',loadKeyStats);
if($('resetKeyBtn'))$('resetKeyBtn').addEventListener('click',async()=>{
const key=$('keyManageInput').value.trim();if(!key)return;
try{const res=await apiFetch(`${API}/admin/keys/reset`,{method:'POST',body:JSON.stringify({key})});const data=await res.json();if(!res.ok)throw new Error(data.error);$('keyManageMsg').textContent=`Đã reset ${data.key}`;$('keyManageMsg').className='setting-msg ok';loadKeyStats()}catch(e){$('keyManageMsg').textContent=e.message;$('keyManageMsg').className='setting-msg err'}
});
if($('revokeKeyBtn'))$('revokeKeyBtn').addEventListener('click',async()=>{
const key=$('keyManageInput').value.trim();if(!key)return;
try{const res=await apiFetch(`${API}/admin/keys/revoke`,{method:'POST',body:JSON.stringify({key})});const data=await res.json();if(!res.ok)throw new Error(data.error);$('keyManageMsg').textContent=`Đã thu hồi ${data.key}`;$('keyManageMsg').className='setting-msg ok';loadKeyStats()}catch(e){$('keyManageMsg').textContent=e.message;$('keyManageMsg').className='setting-msg err'}
});

async function loadOrders(){
try{const res=await apiFetch(`${API}/admin/orders`);const orders=await res.json();const tb=$('ordersTable');if(!tb)return;
if(!orders.length){tb.innerHTML='<tr><td colspan="8" style="text-align:center;color:#9a9aa3;padding:20px">Không có đơn</td></tr>';return}
tb.innerHTML=orders.map(o=>`<tr><td style="font-family:monospace;font-size:12px">${o.orderCode}</td><td>${o.telegramUsername?'@'+o.telegramUsername:o.chatId||'—'}</td><td>${o.plan}</td><td>${o.price.toLocaleString('vi-VN')}đ</td><td>${o.paymentMethod}</td><td><span class="badge badge-${o.status}">${o.status}</span></td><td style="font-size:12px">${new Date(o.createdAt).toLocaleString('vi-VN')}</td><td>${o.status==='pending'?`<button class="btn-mini btn-edit" onclick="confirmOrder('${o.orderCode}')">Xác nhận</button>`:''}${o.status==='delivered'?`<span style="font-family:monospace;font-size:11px">${o.keyValue}</span>`:''}</td></tr>`).join('');
}catch(e){console.error(e)}
}

if($('refreshOrders'))$('refreshOrders').addEventListener('click',loadOrders);

async function confirmOrder(code){
if(!confirm(`Xác nhận đơn ${code}?`))return;
try{const res=await apiFetch(`${API}/admin/orders/${code}/confirm`,{method:'POST'});if(res.ok)loadOrders();else alert('Lỗi')}catch(e){alert(e.message)}
}

window.confirmOrder=confirmOrder;
window.editMovie=editMovie;
window.deleteMovie=deleteMovie;

if($('importKeysBtn'))$('importKeysBtn').addEventListener('click',async()=>{
const text=$('keysInput').value;
const keys=[...new Set(text.split('\n').map(k=>k.trim().toUpperCase()).filter(Boolean))];
if(!keys.length){$('importMsg').textContent='Chưa có key';return}
$('importKeysBtn').disabled=true;$('importMsg').textContent=`Đang import ${keys.length} key...`;$('importMsg').className='setting-msg';
const batches=[];for(let i=0;i<keys.length;i+=100)batches.push(keys.slice(i,i+100));
let total=0;
try{
for(const batch of batches){
const res=await apiFetch(`${API}/admin/keys/import`,{method:'POST',body:JSON.stringify({keys:batch})});
const data=await res.json();
if(!res.ok)throw new Error(data.error);
total+=data.inserted||0;
$('importMsg').textContent=`Đang import... (${total} key mới)`;
}
$('importMsg').textContent=`Hoàn tất! Đã thêm ${total} key mới.`;
$('importMsg').className='setting-msg ok';
$('keysInput').value='';
}catch(e){$('importMsg').textContent='Lỗi: '+e.message;$('importMsg').className='setting-msg err'}
finally{$('importKeysBtn').disabled=false}
});

async function loadSettings(){
try{const res=await apiFetch(`${API}/admin/settings`);const data=await res.json();if($('accessKeyInput'))$('accessKeyInput').value=data.accessKey||''}catch(e){console.error(e)}
}

if($('saveAccessKey'))$('saveAccessKey').addEventListener('click',async()=>{
const msg=$('accessKeyMsg');msg.textContent='';msg.className='setting-msg';
try{const res=await apiFetch(`${API}/admin/settings/access-key`,{method:'PUT',body:JSON.stringify({accessKey:$('accessKeyInput').value.trim()})});const data=await res.json();if(!res.ok)throw new Error(data.error);msg.textContent='Đã cập nhật';msg.classList.add('ok')}catch(e){msg.textContent=e.message;msg.classList.add('err')}
});

if($('savePassword'))$('savePassword').addEventListener('click',async()=>{
const msg=$('passwordMsg');msg.textContent='';msg.className='setting-msg';
try{const res=await apiFetch(`${API}/admin/settings/password`,{method:'PUT',body:JSON.stringify({newPassword:$('newPassword').value})});const data=await res.json();if(!res.ok)throw new Error(data.error);msg.textContent='Đã đổi mật khẩu';msg.classList.add('ok');$('newPassword').value=''}catch(e){msg.textContent=e.message;msg.classList.add('err')}
});

if($('loginBtn'))$('loginBtn').addEventListener('click',login);
if($('password'))$('password').addEventListener('keypress',e=>{if(e.key==='Enter')login()});
if($('username'))$('username').addEventListener('keypress',e=>{if(e.key==='Enter')login()});

if($('logoutBtn'))$('logoutBtn').addEventListener('click',()=>{
if(!confirm('Đăng xuất?'))return;
localStorage.removeItem(TOKEN_KEY);
location.reload();
});

async function initAdmin(){
await loadMovies();
}

if(token){
fetch(`${API}/admin/settings`,{headers:{'Authorization':`Bearer ${token}`}}).then(res=>{
if(res.ok)showApp();
else{localStorage.removeItem(TOKEN_KEY);showLogin()}
}).catch(()=>showLogin());
}else{
showLogin();
}
