'use strict';
// Server otoritatif Monopoli GB. Semua uang, dadu, sewa, dan giliran diputuskan di sini.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
// ALLOWED_ORIGINS dapat berisi beberapa domain, dipisahkan koma.
// Contoh: https://nama-game.netlify.app,https://preview--nama-game.netlify.app
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(x => x.trim()).filter(Boolean);
const corsOrigin = (origin, callback) => {
  if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin tidak diizinkan oleh ALLOWED_ORIGINS'));
};
const io = new Server(server, { cors: { origin: corsOrigin, methods: ['GET', 'POST'] } });
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;

const COLORS = ['#f5b942','#38bdf8','#fb7185','#a78bfa','#4ade80','#fb923c','#e879f9'];
const AVATARS = ['😎','🐱','🐸','🦊','🐼','🐯','🐙','🐧','🦄','👾'];
const GROUPS = {
  brown:{tiles:[1,3],house:50,color:'#a66b43'}, lightblue:{tiles:[6,8,9],house:50,color:'#58c8e8'}, pink:{tiles:[11,13,14],house:100,color:'#ef76b9'}, orange:{tiles:[16,18,19],house:100,color:'#f39a4a'}, red:{tiles:[21,23,24],house:150,color:'#f05252'}, yellow:{tiles:[26,27,29],house:150,color:'#f6d44b'}, green:{tiles:[31,32,34],house:200,color:'#38b86b'}, darkblue:{tiles:[37,39],house:200,color:'#4169e1'}
};
const BOARD = [
 ['START','start',0],['Kuala Lumpur','property',60,'brown'],['Dana Umum','community'],['Bangkok','property',60,'brown'],['Pajak Pemasukan','tax',200],['Bandara Chang-i','airport',200],['Singapura','property',100,'lightblue'],['Kesempatan','chance'],['Manila','property',100,'lightblue'],['Seoul','property',120,'lightblue'],['Penjara','jail'],['Tokyo','property',140,'pink'],['Perusahaan Listrik','utility',150],['Taipei','property',140,'pink'],['Hongkong','property',160,'pink'],['Narita','airport',200],['New Delhi','property',180,'orange'],['Dana Umum','community'],['Riyadh','property',180,'orange'],['Moskow','property',180,'orange'],['Parkir Bebas','free'],['Beijing','property',220,'red'],['Kesempatan','chance'],['Brazilia','property',220,'red'],['London','property',240,'red'],['JFK','airport',200],['Amsterdam','property',260,'yellow'],['Paris','property',260,'yellow'],['Perusahaan Air','utility',150],['Roma','property',280,'yellow'],['Masuk Penjara','gotojail'],['Mexico City','property',300,'green'],['Ottawa','property',300,'green'],['Dana Umum','community'],['Washington','property',320,'green'],['Soekarno-Hatta','airport',200],['Kesempatan','chance'],['Canberra','property',350,'darkblue'],['Pajak Tertinggi','tax',100],['Jakarta','property',400,'darkblue']
].map((x,i)=>({id:i,name:x[0],type:x[1],price:x[2]||0,group:x[3]||null}));
const CHANCE = [
 {text:'Bonus bisnis! Terima Rp 150.000.',money:150},{text:'Bayar biaya perjalanan Rp 50.000.',money:-50},{text:'Maju ke START dan terima gaji.',to:0},{text:'Mundur 3 petak.',back:3},{text:'Langsung ke penjara.',jail:true},{text:'Hadiah lomba! Terima Rp 100.000.',money:100},{text:'Perbaikan kota: bayar Rp 80.000.',money:-80},{text:'Maju ke Jakarta.',to:39}
];
const COMMUNITY = [
 {text:'Dana keluarga: terima Rp 200.000.',money:200},{text:'Tagihan rumah sakit Rp 50.000.',money:-50},{text:'Hadiah kecil Rp 100.000.',money:100},{text:'Biaya sekolah Rp 100.000.',money:-100},{text:'Maju ke START dan terima gaji.',to:0},{text:'Mundur 3 petak.',back:3},{text:'Langsung ke penjara.',jail:true},{text:'Dana umum: terima Rp 50.000.',money:50}
];
const rooms = new Map();
const clone = x => JSON.parse(JSON.stringify(x));
const money = n => Math.round(n);
function roomCode(){ let s=''; do { s=crypto.randomBytes(3).toString('hex').slice(0,4).toUpperCase(); } while(rooms.has(s)); return s; }
function freshRoom(code){return {code,host:null,started:false,players:[],turn:0,phase:'lobby',deadline:null,turnTimer:null,disconnectTimers:{},props:{},history:[],lastEvents:[],doubleStreak:0,turnRolls:0,winner:null,round:1};}
function alive(r){return r.players.filter(p=>!p.bankrupt);}
function active(r){const a=alive(r); if(!a.length)return null; return a[((r.turn%a.length)+a.length)%a.length];}
function playerByToken(r,token){return r.players.find(p=>p.token===token);}
function ownerOf(r,id){return r.props[id]?.owner ? playerByToken(r,r.props[id].owner) : null;}
function groupOwned(r,p,group){return GROUPS[group].tiles.every(id=>r.props[id]?.owner===p.token);}
function assetValue(r,p){return p.cash + Object.entries(r.props).filter(([,v])=>v.owner===p.token).reduce((s,[id,v])=>s+BOARD[+id].price+((v.houses||0)*GROUPS[BOARD[+id].group]?.house||0),0);}
function publicState(r){
 const players=r.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,color:p.color,cash:p.cash,pos:p.pos,connected:p.connected,ready:p.ready,jailed:p.jailed,jailFails:p.jailFails,bankrupt:p.bankrupt,asset:assetValue(r,p),properties:Object.entries(r.props).filter(([,v])=>v.owner===p.token).map(([id,v])=>({id:+id,houses:v.houses||0}))}));
 const props={};for(const [id,v] of Object.entries(r.props)){const owner=playerByToken(r,v.owner);props[id]={owner:owner?.id||null,houses:v.houses||0};}
 return {code:r.code,host:playerByToken(r,r.host)?.id||null,started:r.started,players,turnId:active(r)?.id||null,turn:r.turn,phase:r.phase,deadline:r.deadline,props,history:r.history.slice(-40),winner:playerByToken(r,r.winner)?.id||null,round:r.round,board:BOARD,groups:GROUPS};
}
function pushHistory(r,text){r.history.push({text,at:Date.now()});if(r.history.length>100)r.history.shift();}
function emitState(r,events=[]){r.lastEvents=events;io.to(r.code).emit('update',{state:publicState(r),events});}
function stopTimer(r){if(r.turnTimer)clearTimeout(r.turnTimer);r.turnTimer=null;}
function setTimer(r){stopTimer(r);if(!r.started||r.phase==='gameover')return;r.deadline=Date.now()+60000;r.turnTimer=setTimeout(()=>{if(!r.started||r.phase==='gameover')return;const p=active(r);if(!p)return;if(r.phase==='buy') {r.phase='end';pushHistory(r,`${p.name} melewatkan pembelian karena waktu habis.`);finishTurn(r,false);} else if(r.phase==='roll'){autoRoll(r,p,true);}else finishTurn(r,false);},60000);}
function nextTurn(r,extraRoll=false){if(r.phase==='gameover')return; if(!extraRoll){const a=alive(r);if(a.length<=1){finishGame(r);return;}r.turn=(r.turn+1)%a.length;r.doubleStreak=0;}r.turnRolls=0;r.phase='roll';r.deadline=Date.now()+60000;setTimer(r);emitState(r);}
function finishGame(r){stopTimer(r);r.started=true;r.phase='gameover';r.deadline=null;const ranking=[...r.players].sort((a,b)=>Number(a.bankrupt)-Number(b.bankrupt)||assetValue(r,b)-assetValue(r,a));r.winner=ranking[0]?.token||null;pushHistory(r,`${playerByToken(r,r.winner)?.name||'Pemain'} memenangkan permainan!`);emitState(r,[{type:'bk',winner:r.winner}]);}
function pay(r,p,amount,creditor,events){amount=money(amount);if(amount<=0)return true;if(p.cash<amount){
  const owned=Object.entries(r.props).filter(([,v])=>v.owner===p.token);for(const [id] of owned){delete r.props[id];}
  p.cash=0;p.bankrupt=true;p.jailed=false;events.push({type:'bk',token:p.id});pushHistory(r,`${p.name} bangkrut dan keluar dari permainan.`);return false;
 }
 p.cash-=amount;events.push({type:'$',token:p.id,amount:-amount});if(creditor&&creditor!=='BANK'){const c=playerByToken(r,creditor);if(c&&!c.bankrupt){c.cash+=amount;events.push({type:'$',token:c.id,amount});}}
 return true;
}
function gain(r,p,amount,events){p.cash+=amount;events.push({type:'$',token:p.id,amount});}
function movePlayer(r,p,steps,events,opts={}){
 let next=opts.to!==undefined?opts.to:(p.pos+steps+40)%40;
 if(opts.to===undefined&&steps>0&&p.pos+steps>=40){gain(r,p,200,events);pushHistory(r,`${p.name} melewati START dan menerima Rp 200.000.`);}
 if(opts.to===0&&p.pos!==0&&opts.salary){gain(r,p,200,events);}
 p.pos=next;events.push({type:opts.teleport?'tp':'mv',token:p.id,from:opts.from??p.pos,to:next,steps});
}
function rentFor(r,p,id,diceTotal=0){const tile=BOARD[id],pr=r.props[id];if(!pr||!pr.owner||pr.owner===p.token)return 0;const own=playerByToken(r,pr.owner);if(!own||own.bankrupt)return 0;
 if(tile.type==='airport'){const n=BOARD.filter(t=>t.type==='airport'&&r.props[t.id]?.owner===own.token).length;return 25*Math.pow(2,Math.max(0,n-1));}
 if(tile.type==='utility'){const n=[12,28].filter(i=>r.props[i]?.owner===own.token).length;return diceTotal*(n===2?10:4);}
 const h=pr.houses||0;const base=Math.round(tile.price/16);const mult=[1,5,15,40,55,70][Math.min(h,5)];return base*mult*(groupOwned(r,own,tile.group)&&h===0?2:1);
}
function resolveLanding(r,p,diceTotal,events){const tile=BOARD[p.pos];
 if(tile.type==='property'||tile.type==='airport'||tile.type==='utility'){
  const pr=r.props[tile.id];if(!pr){r.phase='buy';r.pendingBuy=tile.id;pushHistory(r,`${p.name} tiba di ${tile.name}. Properti tersedia untuk dibeli.`);return;}
  if(pr.owner!==p.token){const rent=rentFor(r,p,tile.id,diceTotal);if(rent){const ok=pay(r,p,rent,pr.owner,events);if(ok)pushHistory(r,`${p.name} membayar sewa Rp ${(rent*1000).toLocaleString('id-ID')} ke ${playerByToken(r,pr.owner)?.name||'pemilik'}.`);else pushHistory(r,`${p.name} tidak mampu membayar sewa dan bangkrut.`);}}
 } else if(tile.type==='tax'){pay(r,p,tile.price,'BANK',events);pushHistory(r,`${p.name} membayar pajak Rp ${(tile.price*1000).toLocaleString('id-ID')}.`);}
 else if(tile.type==='gotojail'){p.pos=10;p.jailed=true;p.jailFails=0;events.push({type:'tp',token:p.id,from:30,to:10});r.phase='end';pushHistory(r,`${p.name} masuk penjara.`);}
 else if(tile.type==='chance'||tile.type==='community'){
  const card=clone((tile.type==='chance'?CHANCE:COMMUNITY)[Math.floor(Math.random()*(tile.type==='chance'?CHANCE:COMMUNITY).length)]);events.push({type:'card',card:tile.type,text:card.text});pushHistory(r,`${p.name}: ${card.text}`);
  if(card.money>0)gain(r,p,card.money,events);else if(card.money<0)pay(r,p,-card.money,'BANK',events);
  if(card.jail){p.pos=10;p.jailed=true;p.jailFails=0;events.push({type:'tp',token:p.id,from:tile.id,to:10});r.phase='end';}
  else if(card.back){movePlayer(r,p,-card.back,events);resolveLanding(r,p,diceTotal,events);}
  else if(card.to!==undefined){const old=p.pos;if(card.to<old)gain(r,p,200,events);p.pos=card.to;events.push({type:'tp',token:p.id,from:old,to:card.to});resolveLanding(r,p,diceTotal,events);}
 }
 if(p.bankrupt)r.phase='end';
}
function autoRoll(r,p,timed=false){if(r.phase!=='roll'||active(r)?.token!==p.token)return;const d1=1+Math.floor(Math.random()*6),d2=1+Math.floor(Math.random()*6),dbl=d1===d2,events=[{type:'dice',d1,d2}];r.turnRolls++;
 if(p.jailed){if(dbl){p.jailed=false;p.jailFails=0;pushHistory(r,`${p.name} keluar penjara dengan dadu kembar.`);movePlayer(r,p,d1+d2,events);resolveLanding(r,p,d1+d2,events);}else{p.jailFails=(p.jailFails||0)+1;if(p.jailFails>=3){pay(r,p,50,'BANK',events);p.jailed=false;p.jailFails=0;movePlayer(r,p,d1+d2,events);resolveLanding(r,p,d1+d2,events);}else{r.phase='end';pushHistory(r,`${p.name} gagal keluar penjara (${p.jailFails}/3).`);}}}
 else {if(dbl)r.doubleStreak++;else r.doubleStreak=0;if(r.doubleStreak>=3){p.pos=10;p.jailed=true;p.jailFails=0;events.push({type:'tp',token:p.id,from:p.pos,to:10});r.phase='end';r.doubleStreak=0;pushHistory(r,`${p.name} mendapat tiga kali kembar dan masuk penjara.`);}else{movePlayer(r,p,d1+d2,events);resolveLanding(r,p,d1+d2,events);if(dbl&&r.phase!=='buy'&&r.phase!=='end')r.phase='roll';else if(dbl&&r.phase==='buy')r.extraDouble=true;else if(!dbl&&r.phase==='roll')r.phase='end';}}
 if(timed){if(r.phase==='buy'){r.phase='end';r.pendingBuy=null;}if(r.phase==='roll')r.phase='end';r.extraDouble=false;}pushHistory(r,`${p.name} melempar ${d1} + ${d2}.`);emitState(r,events);if(timed){finishTurn(r,false);return;}setTimer(r);
}
function finishTurn(r,rollAgain){stopTimer(r);r.pendingBuy=null;if(r.phase==='gameover')return;if(rollAgain){r.phase='roll';setTimer(r);emitState(r);return;}r.extraDouble=false;nextTurn(false);}
function canAct(r,p){return r.started&&r.phase!=='gameover'&&active(r)?.token===p.token&&!p.bankrupt;}
function error(socket,msg){socket.emit('notice',{type:'error',text:msg});}
function sanitizeName(s){return String(s||'Pemain').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,12)||'Pemain';}
function joinRoom(socket, payload, create){const token=String(payload.token||'').slice(0,100)||crypto.randomBytes(24).toString('hex');let r,code;
 if(create){code=roomCode();r=freshRoom(code);rooms.set(code,r);}else{code=String(payload.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);r=rooms.get(code);if(!r)return error(socket,'Kode room tidak ditemukan. Periksa 4 huruf/angka.');}
 let p=playerByToken(r,token);
 if(!p){if(r.started)return error(socket,'Game sudah dimulai. Room tidak menerima pemain baru.');if(r.players.length>=7)return error(socket,'Room penuh (maksimal 7 pemain).');p={id:crypto.randomUUID(),token,name:sanitizeName(payload.name),avatar:AVATARS.includes(payload.avatar)?payload.avatar:'😎',color:COLORS.includes(payload.color)?payload.color:COLORS[r.players.length%COLORS.length],cash:1500,pos:0,connected:true,ready:false,jailed:false,jailFails:0,bankrupt:false,socketId:socket.id,joinedAt:Date.now()};r.players.push(p);if(!r.host)r.host=token;pushHistory(r,`${p.name} bergabung ke room.`);}
 else {p.connected=true;p.socketId=socket.id;if(r.disconnectTimers[token]){clearTimeout(r.disconnectTimers[token]);delete r.disconnectTimers[token];}}
 socket.join(r.code);socket.data.room=r.code;socket.data.token=token;socket.emit('joined',{token,code:r.code,playerId:p.id,created:create});emitState(r);}
function doAction(socket,action,data={}){const r=rooms.get(socket.data.room);if(!r)return;const p=playerByToken(r,socket.data.token);if(!p)return;const host=p.token===r.host;let events=[];
 if(action==='ready'){if(r.started)return;p.ready=!!data.ready;emitState(r);return;}
 if(action==='kick'){if(r.started||!host)return error(socket,'Hanya host di lobby yang bisa mengeluarkan pemain.');const target=r.players.find(x=>x.id===String(data.token||''));if(!target||target.token===r.host)return;if(target.socketId)io.to(target.socketId).emit('kicked');r.players=r.players.filter(x=>x!==target);pushHistory(r,`${target.name} dikeluarkan dari room.`);emitState(r);return;}
 if(action==='start'){if(!host||r.started)return error(socket,'Hanya host yang dapat memulai game.');if(r.players.length<2||r.players.some(x=>!x.ready))return error(socket,'Minimal 2 pemain dan semua pemain harus siap.');r.started=true;r.phase='roll';r.turn=0;r.deadline=Date.now()+60000;pushHistory(r,'Permainan dimulai!');setTimer(r);emitState(r,[{type:'card',text:'Permainan dimulai!'}]);return;}
 if(action==='react'){const now=Date.now();if((socket.data.reactAt||0)>now-900)return;socket.data.reactAt=now;if(['👏','😂','😭','🔥'].includes(data.emoji))io.to(r.code).emit('reaction',{token:p.id,emoji:data.emoji});return;}
 if(action==='rematch'){if(r.phase!=='gameover'||!host)return error(socket,'Hanya host setelah game selesai yang bisa memulai ulang.');stopTimer(r);r.started=false;r.phase='lobby';r.winner=null;r.props={};r.turn=0;r.doubleStreak=0;r.players.forEach(x=>{x.cash=1500;x.pos=0;x.jailed=false;x.jailFails=0;x.bankrupt=false;x.ready=x.token===r.host;});pushHistory(r,'Rematch dimulai. Semua pemain kembali ke lobby.');emitState(r);return;}
 if(!canAct(r,p))return error(socket,'Bukan giliranmu atau fase aksi sudah berubah.');
 if(action==='roll'){if(r.phase!=='roll')return error(socket,'Belum bisa melempar dadu pada fase ini.');autoRoll(r,p);return;}
 if(action==='payjail'){if(r.phase!=='roll'||!p.jailed)return error(socket,'Kamu tidak sedang berada di penjara.');if(p.cash<50)return error(socket,'Uang tidak cukup untuk membayar Rp 50.000.');p.cash-=50;p.jailed=false;p.jailFails=0;pushHistory(r,`${p.name} membayar Rp 50.000 untuk keluar dari penjara.`);events.push({type:'$',token:p.id,amount:-50});emitState(r,events);return;}
 if(action==='buy'){if(r.phase!=='buy'||r.pendingBuy==null)return error(socket,'Tidak ada properti yang bisa dibeli.');const id=r.pendingBuy,t=BOARD[id];if(p.cash<t.price)return error(socket,'Uang tidak cukup untuk membeli properti ini.');p.cash-=t.price;r.props[id]={owner:p.token,houses:0};events.push({type:'own',id,token:p.id},{type:'$',token:p.id,amount:-t.price});pushHistory(r,`${p.name} membeli ${t.name}.`);const again=!!r.extraDouble;r.phase='end';r.pendingBuy=null;emitState(r,events);if(again){r.extraDouble=false;finishTurn(r,true);}return;}
 if(action==='skip'){if(r.phase!=='buy')return error(socket,'Tidak ada pembelian untuk dilewati.');const again=!!r.extraDouble;r.phase='end';r.pendingBuy=null;pushHistory(r,`${p.name} melewati pembelian.`);emitState(r);if(again){r.extraDouble=false;finishTurn(r,true);}return;}
 if(action==='build'){const id=Number(data.id),t=BOARD[id],pr=r.props[id];if(r.phase!=='roll'&&r.phase!=='end')return error(socket,'Belum bisa membangun saat fase ini.');if(!pr||pr.owner!==p.token||!t.group||!groupOwned(r,p,t.group))return error(socket,'Kamu harus memiliki satu set warna lengkap.');const group=GROUPS[t.group],min=Math.min(...group.tiles.map(i=>r.props[i]?.houses||0));if((pr.houses||0)!==min)return error(socket,'Rumah harus dibangun merata dalam satu set warna.');if(pr.houses>=5)return error(socket,'Petak ini sudah memiliki hotel.');if(p.cash<group.house)return error(socket,'Uang tidak cukup untuk membangun.');p.cash-=group.house;pr.houses++;events.push({type:'build',id,houses:pr.houses,token:p.id},{type:'$',token:p.id,amount:-group.house});pushHistory(r,`${p.name} membangun ${pr.houses===5?'hotel':'rumah'} di ${t.name}.`);emitState(r,events);return;}
 if(action==='end'){if(r.phase==='buy')return error(socket,'Pilih Beli atau Lewati terlebih dahulu.');if(r.phase!=='end')return error(socket,'Aksi Selesai belum tersedia.');const dbl=!!r.extraDouble;r.extraDouble=false;finishTurn(r,dbl);return;}
}
io.on('connection',socket=>{
 socket.on('create',payload=>joinRoom(socket,payload||{},true));socket.on('join',payload=>joinRoom(socket,payload||{},false));
 socket.on('action',msg=>{if(!msg||typeof msg.action!=='string')return;try{doAction(socket,msg.action,msg.data||{});}catch(e){console.error(e);error(socket,'Terjadi kesalahan. Coba lagi.');}});
 socket.on('disconnect',()=>{const r=rooms.get(socket.data.room);if(!r)return;const p=playerByToken(r,socket.data.token);if(!p||p.socketId!==socket.id)return;p.connected=false;pushHistory(r,`${p.name} terputus koneksi.`);emitState(r);r.disconnectTimers[p.token]=setTimeout(()=>{const pp=playerByToken(r,p.token);if(!pp||pp.connected)return;if(r.started&&active(r)?.token===pp.token){pushHistory(r,`${pp.name} melewati giliran karena terputus terlalu lama.`);finishTurn(r,false);}else if(!r.started&&pp.token!==r.host){r.players=r.players.filter(x=>x.token!==pp.token);emitState(r);}},60000);});
});
server.listen(PORT,()=>console.log(`Monopoli GB berjalan di port ${PORT}`));
