import { useState, useEffect, useRef } from "react";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBbiuXhJyHnqZM-H_wrIGpnKarG8UKUU6s",
  authDomain: "bahce-liste.firebaseapp.com",
  databaseURL: "https://bahce-liste-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bahce-liste",
};

function loadFirebase() {
  return new Promise((resolve, reject) => {
    if (window._firebaseLoaded) { resolve(); return; }
    const app = document.createElement("script");
    app.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js";
    app.onload = () => {
      const db = document.createElement("script");
      db.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js";
      db.onload = () => { window._firebaseLoaded = true; resolve(); };
      db.onerror = reject;
      document.head.appendChild(db);
    };
    app.onerror = reject;
    document.head.appendChild(app);
  });
}

function getDB() {
  if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
  return window.firebase.database();
}

const todayStr = () => new Date().toISOString().split("T")[0];
const randCode = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const MONTHS_TR = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const DAYS_TR = ["Pt","Sa","Ça","Pe","Cu","Ct","Pz"];
const GROUP_COLORS = ["#f59e0b","#22c55e","#3b82f6","#a855f7","#ef4444","#06b6d4","#f97316","#84cc16"];

function getFirstDayOfMonth(y, m) { let d = new Date(y,m,1).getDay(); return d===0?6:d-1; }
function getDaysInMonth(y, m) { return new Date(y,m+1,0).getDate(); }

export default function App() {
  const [fbReady, setFbReady] = useState(false);
  const [screen, setScreen] = useState("lobby");
  const [roomCode, setRoomCode] = useState("");
  const [myName, setMyName] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [nameInput, setNameInput] = useState("");

  // groups: [{id, name, color, order}]
  // tasks: [{id, name, by, deadline, groupId, order}]  — groupId=null means ungrouped
  const [groups, setGroups] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [oneTimeTasks, setOneTimeTasks] = useState([]);
  const [checked, setChecked] = useState({});
  const [note, setNote] = useState("");

  const [newTask, setNewTask] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [newTaskGroup, setNewTaskGroup] = useState(null);
  const [newOneTime, setNewOneTime] = useState("");
  const [newOneTimeDeadline, setNewOneTimeDeadline] = useState("");
  const [newOneTimeGroup, setNewOneTimeGroup] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editGroup, setEditGroup] = useState(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editGroupName, setEditGroupName] = useState("");

  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("routine");
  const [copyMsg, setCopyMsg] = useState(false);
  const [mainView, setMainView] = useState("list");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const listenersRef = useRef([]);

  useEffect(() => {
    loadFirebase().then(() => setFbReady(true)).catch(e => console.error(e));
    const savedRoom = localStorage.getItem("cl-room");
    const savedName = localStorage.getItem("cl-name");
    if (savedRoom && savedName) { setRoomCode(savedRoom); setMyName(savedName); }
  }, []);

  useEffect(() => {
    if (!fbReady || !roomCode) return;
    attachListeners(roomCode, myName, selectedDate);
    return () => detachListeners();
  }, [fbReady, roomCode, myName, selectedDate]);

  const detachListeners = () => {
    listenersRef.current.forEach(({ ref, fn }) => ref.off("value", fn));
    listenersRef.current = [];
  };

  const attachListeners = (room, name, date) => {
    detachListeners();
    const db = getDB();

    const groupsRef = db.ref(`rooms/${room}/groups`);
    const groupsFn = snap => setGroups(snap.val() ? Object.values(snap.val()).sort((a,b)=>(a.order||0)-(b.order||0)) : []);
    groupsRef.on("value", groupsFn);

    const tasksRef = db.ref(`rooms/${room}/tasks`);
    const tasksFn = snap => setTasks(snap.val() ? Object.values(snap.val()).sort((a,b)=>(a.order||0)-(b.order||0)) : []);
    tasksRef.on("value", tasksFn);

    const otRef = db.ref(`rooms/${room}/onetime/${date}`);
    const otFn = snap => setOneTimeTasks(snap.val() ? Object.values(snap.val()) : []);
    otRef.on("value", otFn);

    const noteRef = db.ref(`rooms/${room}/notes/${date}`);
    const noteFn = snap => setNote(snap.val() || "");
    noteRef.on("value", noteFn);

    const doneRef = db.ref(`rooms/${room}/done/${date}/${name}`);
    const doneFn = snap => setChecked(snap.val() || {});
    doneRef.on("value", doneFn);

    listenersRef.current = [
      { ref: groupsRef, fn: groupsFn },
      { ref: tasksRef, fn: tasksFn },
      { ref: otRef, fn: otFn },
      { ref: noteRef, fn: noteFn },
      { ref: doneRef, fn: doneFn },
    ];
    setScreen("app");
  };

  const joinRoom = (code, name) => {
    const clean = code.trim().toUpperCase(), cleanName = name.trim();
    if (!clean || !cleanName) return;
    localStorage.setItem("cl-room", clean);
    localStorage.setItem("cl-name", cleanName);
    setRoomCode(clean); setMyName(cleanName);
  };

  const leaveRoom = () => {
    detachListeners();
    localStorage.removeItem("cl-room"); localStorage.removeItem("cl-name");
    setRoomCode(""); setMyName(""); setScreen("lobby");
    setGroups([]); setTasks([]); setOneTimeTasks([]); setChecked({}); setNote("");
  };

  const db = () => getDB();
  const rp = (room) => `rooms/${room}`;

  // ── Groups ──
  const addGroup = async () => {
    const name = newGroupName.trim(); if (!name) return;
    const id = `g-${Date.now()}`;
    const color = GROUP_COLORS[groups.length % GROUP_COLORS.length];
    await db().ref(`${rp(roomCode)}/groups/${id}`).set({ id, name, color, order: groups.length });
    setNewGroupName(""); setShowGroupForm(false);
  };

  const deleteGroup = async (gid) => {
    await db().ref(`${rp(roomCode)}/groups/${gid}`).remove();
    // Move tasks in this group to ungrouped
    const batch = {};
    tasks.filter(t => t.groupId === gid).forEach(t => { batch[`${rp(roomCode)}/tasks/${t.id}/groupId`] = null; });
    if (Object.keys(batch).length) await db().ref().update(batch);
  };

  const saveGroupEdit = async (gid) => {
    if (!editGroupName.trim()) { setEditingGroupId(null); return; }
    await db().ref(`${rp(roomCode)}/groups/${gid}`).update({ name: editGroupName.trim() });
    setEditingGroupId(null);
  };

  const moveGroup = async (index, dir) => {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= groups.length) return;
    const u = [...groups];
    [u[index], u[newIndex]] = [u[newIndex], u[index]];
    const batch = {};
    u.forEach((g, i) => { batch[`${rp(roomCode)}/groups/${g.id}/order`] = i; });
    await db().ref().update(batch);
  };

  // ── Tasks ──
  const addTask = async () => {
    const name = newTask.trim(); if (!name) return;
    const id = `r-${Date.now()}`;
    const groupTasks = tasks.filter(t => (t.groupId || null) === (newTaskGroup || null));
    await db().ref(`${rp(roomCode)}/tasks/${id}`).set({ id, name, by: myName, deadline: newTaskDeadline || null, groupId: newTaskGroup || null, order: groupTasks.length });
    setNewTask(""); setNewTaskDeadline("");
  };

  const addOneTime = async () => {
    const name = newOneTime.trim(); if (!name) return;
    const id = `o-${Date.now()}`;
    await db().ref(`${rp(roomCode)}/onetime/${selectedDate}/${id}`).set({ id, name, by: myName, deadline: newOneTimeDeadline || null, groupId: newOneTimeGroup || null });
    setNewOneTime(""); setNewOneTimeDeadline("");
  };

  const deleteTask = async (id) => {
    if (id.startsWith("o-")) await db().ref(`${rp(roomCode)}/onetime/${selectedDate}/${id}`).remove();
    else await db().ref(`${rp(roomCode)}/tasks/${id}`).remove();
    await db().ref(`${rp(roomCode)}/done/${selectedDate}/${myName}/${id}`).remove();
  };

  const toggleCheck = async (id) => {
    await db().ref(`${rp(roomCode)}/done/${selectedDate}/${myName}/${id}`).set(!checked[id]);
  };

  const startEdit = (task) => { setEditingId(task.id); setEditText(task.name); setEditDeadline(task.deadline||""); setEditGroup(task.groupId||null); };
  const saveEdit = async () => {
    if (!editText.trim()) { setEditingId(null); return; }
    const updates = { name: editText.trim(), deadline: editDeadline||null, groupId: editGroup||null };
    if (editingId.startsWith("o-")) await db().ref(`${rp(roomCode)}/onetime/${selectedDate}/${editingId}`).update(updates);
    else await db().ref(`${rp(roomCode)}/tasks/${editingId}`).update(updates);
    setEditingId(null);
  };

  const moveTask = async (taskId, groupId, index, dir) => {
    const groupTasks = tasks.filter(t => (t.groupId||null) === (groupId||null));
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= groupTasks.length) return;
    const u = [...groupTasks];
    [u[index], u[newIndex]] = [u[newIndex], u[index]];
    const batch = {};
    u.forEach((t, i) => { batch[`${rp(roomCode)}/tasks/${t.id}/order`] = i; });
    await db().ref().update(batch);
  };

  const saveNote = async (v) => {
    setSaving(true);
    await db().ref(`${rp(roomCode)}/notes/${selectedDate}`).set(v);
    setTimeout(() => setSaving(false), 700);
  };

  const copyCode = () => { navigator.clipboard.writeText(roomCode).catch(()=>{}); setCopyMsg(true); setTimeout(()=>setCopyMsg(false),1500); };
  const toggleCollapse = (gid) => setCollapsedGroups(prev => ({ ...prev, [gid]: !prev[gid] }));

  const allTasks = [...tasks, ...oneTimeTasks];
  const completedCount = allTasks.filter(t => checked[t.id]).length;
  const progress = allTasks.length > 0 ? (completedCount / allTasks.length) * 100 : 0;

  const deadlineLabel = (dl) => {
    if (!dl) return null;
    const diff = Math.ceil((new Date(dl) - new Date(todayStr())) / 86400000);
    if (diff < 0) return { text: `${Math.abs(diff)}g gecikti`, color: "#ef4444" };
    if (diff === 0) return { text: "bugün son!", color: "#f59e0b" };
    if (diff === 1) return { text: "yarın son", color: "#ea580c" };
    return { text: `${diff}g kaldı`, color: "#6b7280" };
  };

  const fmtDate = (d) => new Date(d+"T00:00:00").toLocaleDateString("tr-TR",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const dayStr = (y,m,d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const isToday = (y,m,d) => { const t=new Date(); return t.getFullYear()===y&&t.getMonth()===m&&t.getDate()===d; };
  const selectCalDay = (ds) => { setSelectedDate(ds); setMainView("list"); };

  const getGroupColor = (gid) => groups.find(g=>g.id===gid)?.color || "#e5e7eb";
  const getGroupName = (gid) => groups.find(g=>g.id===gid)?.name || "";

  if (!fbReady) return (
    <div style={s.center}>
      <div style={s.spinner} />
      <div style={{marginTop:12,color:"#a07050",fontSize:13}}>Bağlanıyor…</div>
    </div>
  );

  // ── LOBBY ──
  if (screen === "lobby") return (
    <div style={s.root}>
      <div style={{...s.card,maxWidth:400,textAlign:"center"}}>
        <div style={{fontSize:44,marginBottom:8}}>📋</div>
        <h1 style={s.title}>Günlük Checklist</h1>
        <p style={{color:"#a07050",fontSize:14,marginBottom:20,lineHeight:1.6}}>Oda kodu ile arkadaşınızla gerçek zamanlı paylaşın.</p>
        <input value={nameInput} onChange={e=>setNameInput(e.target.value)} placeholder="Adınız" style={{...s.input,marginBottom:10,textAlign:"center"}} />
        <button onClick={()=>joinRoom(randCode(),nameInput)} style={{...s.btn,background:"#22c55e",width:"100%",marginBottom:10}}>✨ Yeni Oda Oluştur</button>
        <div style={{color:"#c0a080",fontSize:12,margin:"8px 0",fontStyle:"italic"}}>— veya mevcut odaya katıl —</div>
        <div style={{display:"flex",gap:8}}>
          <input value={roomInput} onChange={e=>setRoomInput(e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&joinRoom(roomInput,nameInput)} placeholder="ODA KODU" maxLength={8} style={{...s.input,flex:1,textAlign:"center",letterSpacing:3,fontWeight:700}} />
          <button onClick={()=>joinRoom(roomInput,nameInput)} style={{...s.btn,background:"#f59e0b"}}>Katıl →</button>
        </div>
      </div>
    </div>
  );

  // ── TASK ROW ──
  const TaskRow = ({ task, groupTasks, index, isRoutine }) => {
    const dl = deadlineLabel(task.deadline);
    const isDone = checked[task.id];
    const gColor = task.groupId ? getGroupColor(task.groupId) : null;
    return (
      <div style={{...s.taskRow, opacity:isDone?0.5:1, borderLeft: gColor ? `3px solid ${gColor}` : isRoutine?"3px solid #e5e7eb":"3px solid #f59e0b"}}>
        {isRoutine ? (
          <div style={{display:"flex",flexDirection:"column",gap:1,flexShrink:0}}>
            <button onClick={()=>moveTask(task.id,task.groupId,index,-1)} disabled={index===0} style={{...s.orderBtn,opacity:index===0?0.2:0.6}}>▲</button>
            <button onClick={()=>moveTask(task.id,task.groupId,index,1)} disabled={index===groupTasks.length-1} style={{...s.orderBtn,opacity:index===groupTasks.length-1?0.2:0.6}}>▼</button>
          </div>
        ) : <div style={{width:18,flexShrink:0}} />}

        <button onClick={()=>toggleCheck(task.id)} style={{...s.checkbox,background:isDone?"#22c55e":"transparent",borderColor:isDone?"#22c55e":"#d1d5db"}}>
          {isDone&&<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>

        <div style={{flex:1,minWidth:0}}>
          {editingId===task.id ? (
            <div>
              <input autoFocus value={editText} onChange={e=>setEditText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveEdit()} style={{...s.editInput,marginBottom:6}} />
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:4}}>
                <span style={{fontSize:11,color:"#a07050"}}>Grup:</span>
                <select value={editGroup||""} onChange={e=>setEditGroup(e.target.value||null)} style={s.select}>
                  <option value="">— Grubsuz —</option>
                  {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:11,color:"#a07050"}}>Son tarih:</span>
                <input type="date" value={editDeadline} onChange={e=>setEditDeadline(e.target.value)} style={s.dateInput} />
                {editDeadline&&<button onClick={()=>setEditDeadline("")} style={s.clearDate}>✕</button>}
                <button onClick={saveEdit} style={{...s.btn,fontSize:11,padding:"3px 10px",background:"#22c55e"}}>Kaydet</button>
              </div>
            </div>
          ) : (
            <>
              <span style={{...s.taskName,textDecoration:isDone?"line-through":"none"}} onDoubleClick={()=>startEdit(task)}>
                {task.name}
                {!isRoutine&&<span style={s.badge}>bugün</span>}
              </span>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:2}}>
                {task.by&&<span style={s.byLabel}>ekleyen: {task.by}</span>}
                {dl&&<span style={{...s.byLabel,color:dl.color,fontWeight:600}}>⏰ {dl.text}</span>}
                {task.deadline&&<span style={{...s.byLabel,color:"#b0b8c8"}}>{task.deadline}</span>}
              </div>
            </>
          )}
        </div>

        <div style={s.actions}>
          <button onClick={()=>startEdit(task)} style={s.iconBtn}>✏️</button>
          <button onClick={()=>deleteTask(task.id)} style={s.iconBtn}>🗑️</button>
        </div>
      </div>
    );
  };

  // ── GROUP SECTION ──
  const GroupSection = ({ group, gIndex }) => {
    const gTasks = tasks.filter(t => (t.groupId||null) === (group ? group.id : null));
    const otGTasks = oneTimeTasks.filter(t => (t.groupId||null) === (group ? group.id : null));
    const allGTasks = [...gTasks, ...otGTasks];
    const doneCount = allGTasks.filter(t=>checked[t.id]).length;
    const gid = group ? group.id : "__none__";
    const isCollapsed = collapsedGroups[gid];
    const color = group ? group.color : "#9ca3af";

    return (
      <div style={{marginBottom:16}}>
        {/* Group header */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <div style={{width:4,height:20,borderRadius:2,background:color,flexShrink:0}} />

          {editingGroupId===gid ? (
            <input autoFocus value={editGroupName} onChange={e=>setEditGroupName(e.target.value)} onBlur={()=>saveGroupEdit(gid)} onKeyDown={e=>e.key==="Enter"&&saveGroupEdit(gid)} style={{...s.editInput,flex:1,fontSize:13}} />
          ) : (
            <span style={{fontWeight:700,fontSize:13,color:"#2d1f0e",flex:1,cursor:"pointer"}} onClick={()=>toggleCollapse(gid)}>
              {group ? group.name : "Grubsuz"}
              <span style={{fontWeight:400,fontSize:11,color:"#a07050",marginLeft:8}}>{doneCount}/{allGTasks.length}</span>
            </span>
          )}

          <div style={{display:"flex",gap:3,alignItems:"center"}}>
            {group && (
              <>
                <button onClick={()=>moveGroup(gIndex,-1)} disabled={gIndex===0} style={{...s.orderBtn,opacity:gIndex===0?0.2:0.5,fontSize:9}}>▲</button>
                <button onClick={()=>moveGroup(gIndex,1)} disabled={gIndex===groups.length-1} style={{...s.orderBtn,opacity:gIndex===groups.length-1?0.2:0.5,fontSize:9}}>▼</button>
                <button onClick={()=>{setEditingGroupId(gid);setEditGroupName(group.name);}} style={{...s.iconBtn,fontSize:11,opacity:0.5}}>✏️</button>
                <button onClick={()=>deleteGroup(group.id)} style={{...s.iconBtn,fontSize:11,opacity:0.5}}>🗑️</button>
              </>
            )}
            <button onClick={()=>toggleCollapse(gid)} style={{...s.iconBtn,fontSize:13,opacity:0.5}}>{isCollapsed?"▶":"▼"}</button>
          </div>
        </div>

        {!isCollapsed && (
          <div style={{paddingLeft:12}}>
            {allGTasks.length===0 && <div style={{color:"#c0a080",fontSize:12,fontStyle:"italic",padding:"4px 0"}}>Henüz görev yok</div>}
            {gTasks.map((task,i)=><TaskRow key={task.id} task={task} groupTasks={gTasks} index={i} isRoutine={true} />)}
            {otGTasks.map((task,i)=><TaskRow key={task.id} task={task} groupTasks={otGTasks} index={i} isRoutine={false} />)}
          </div>
        )}
      </div>
    );
  };

  // ── CALENDAR ──
  const CalendarView = () => {
    const daysInMonth = getDaysInMonth(calYear,calMonth);
    const firstDay = getFirstDayOfMonth(calYear,calMonth);
    const cells = [...Array(firstDay).fill(null),...Array.from({length:daysInMonth},(_,i)=>i+1)];
    return (
      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <button onClick={()=>{let m=calMonth-1,y=calYear;if(m<0){m=11;y--;}setCalMonth(m);setCalYear(y);}} style={s.calNav}>‹</button>
          <span style={{fontWeight:700,fontSize:16,color:"#2d1f0e"}}>{MONTHS_TR[calMonth]} {calYear}</span>
          <button onClick={()=>{let m=calMonth+1,y=calYear;if(m>11){m=0;y++;}setCalMonth(m);setCalYear(y);}} style={s.calNav}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:4}}>
          {DAYS_TR.map(d=><div key={d} style={{textAlign:"center",fontSize:11,color:"#a07050",fontWeight:700,padding:"3px 0",fontFamily:"monospace"}}>{d}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
          {cells.map((d,i)=>{
            if(!d) return <div key={`e${i}`}/>;
            const ds=dayStr(calYear,calMonth,d);
            const deadlines=allTasks.filter(t=>t.deadline===ds);
            const isTod=isToday(calYear,calMonth,d);
            const isSel=ds===selectedDate;
            return (
              <div key={ds} onClick={()=>selectCalDay(ds)} style={{...s.calCell,background:isSel?"#f59e0b":isTod?"#fff7ed":"#fff",border:isTod?"2px solid #f59e0b":"1px solid #f0e4cc",color:isSel?"#fff":"#2d1f0e"}}>
                <div style={{fontWeight:isTod||isSel?700:400,fontSize:13}}>{d}</div>
                {deadlines.length>0&&(
                  <div style={{display:"flex",gap:2,marginTop:2,justifyContent:"center"}}>
                    {deadlines.slice(0,3).map(t=><div key={t.id} style={{width:5,height:5,borderRadius:"50%",background:isSel?"rgba(255,255,255,0.8)":"#ef4444"}}/>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{marginTop:12,fontSize:11,color:"#a07050",fontFamily:"monospace",textAlign:"center"}}>🔴 deadline olan görevler</div>
      </div>
    );
  };

  // ── APP ──
  // Build ordered sections: groups in order, then ungrouped at its position
  // We'll render groups in their order, ungrouped always shown
  const ungroupedTasks = tasks.filter(t=>!t.groupId);
  const ungroupedOT = oneTimeTasks.filter(t=>!t.groupId);

  return (
    <div style={s.root}>
      <div style={s.card}>
        {/* Top bar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
          <div style={s.dateLabel}>{fmtDate(selectedDate)}</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <div style={s.roomPill} onClick={copyCode}>🏠 {roomCode} {copyMsg?"✓":"⎘"}</div>
            <span style={s.nameTag}>👤 {myName}</span>
            <button onClick={leaveRoom} style={s.leaveBtn}>✕</button>
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <h1 style={{...s.title,margin:0}}>{mainView==="list"?"Görevler":"Takvim"}</h1>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setMainView("list")} style={{...s.viewBtn,...(mainView==="list"?s.viewBtnActive:{})}}>📋 Liste</button>
            <button onClick={()=>setMainView("calendar")} style={{...s.viewBtn,...(mainView==="calendar"?s.viewBtnActive:{})}}>📅 Takvim</button>
          </div>
        </div>

        {mainView==="calendar" ? <CalendarView /> : (
          <>
            {allTasks.length>0&&(
              <div style={{...s.progressWrap,marginBottom:16}}>
                <div style={s.progressTrack}><div style={{...s.progressFill,width:`${progress}%`}}/></div>
                <span style={s.progressText}>{completedCount}/{allTasks.length}</span>
              </div>
            )}

            {/* Groups */}
            <div style={{marginBottom:8}}>
              {/* Ungrouped first if no groups, or render in mixed order */}
              {(ungroupedTasks.length>0||ungroupedOT.length>0) && (
                <GroupSection group={null} gIndex={-1} />
              )}
              {groups.map((g,i)=><GroupSection key={g.id} group={g} gIndex={i} />)}
            </div>

            {/* Group management */}
            <div style={{marginBottom:14}}>
              {showGroupForm ? (
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input autoFocus value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addGroup()} placeholder="Grup adı..." style={{...s.input,flex:1}} />
                  <button onClick={addGroup} style={{...s.btn,background:"#a855f7",padding:"9px 14px"}}>+ Ekle</button>
                  <button onClick={()=>setShowGroupForm(false)} style={{...s.btn,background:"#e5e7eb",color:"#6b7280",padding:"9px 14px"}}>İptal</button>
                </div>
              ) : (
                <button onClick={()=>setShowGroupForm(true)} style={{...s.btn,background:"#f3e8ff",color:"#a855f7",border:"1.5px dashed #a855f7",width:"100%",fontSize:13}}>+ Yeni Grup Ekle</button>
              )}
            </div>

            {/* Add task tabs */}
            <div style={s.tabs}>
              <button onClick={()=>setActiveTab("routine")} style={{...s.tab,...(activeTab==="routine"?s.tabGreen:{})}}>🔁 Rutin</button>
              <button onClick={()=>setActiveTab("onetime")} style={{...s.tab,...(activeTab==="onetime"?s.tabOrange:{})}}>⚡ Bugüne Özel</button>
            </div>

            {activeTab==="routine" ? (
              <>
                <div style={s.addRow}>
                  <input value={newTask} onChange={e=>setNewTask(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTask()} placeholder="Rutin görev ekle..." style={s.input} />
                  <button onClick={addTask} style={{...s.btn,background:"#22c55e"}}>+ Ekle</button>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                  <span style={{fontSize:12,color:"#a07050"}}>Grup:</span>
                  <select value={newTaskGroup||""} onChange={e=>setNewTaskGroup(e.target.value||null)} style={s.select}>
                    <option value="">— Grubsuz —</option>
                    {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <span style={{fontSize:12,color:"#a07050"}}>Son tarih:</span>
                  <input type="date" value={newTaskDeadline} onChange={e=>setNewTaskDeadline(e.target.value)} style={s.dateInput} />
                  {newTaskDeadline&&<button onClick={()=>setNewTaskDeadline("")} style={s.clearDate}>✕</button>}
                </div>
                <div style={s.hint}>💡 ▲▼ ile sıralayın · Değişiklikler anında senkronize olur</div>
              </>
            ) : (
              <>
                <div style={s.addRow}>
                  <input value={newOneTime} onChange={e=>setNewOneTime(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addOneTime()} placeholder="Bugüne özel görev ekle..." style={{...s.input,borderColor:"#fed7aa"}} />
                  <button onClick={addOneTime} style={{...s.btn,background:"#f59e0b"}}>+ Ekle</button>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                  <span style={{fontSize:12,color:"#a07050"}}>Grup:</span>
                  <select value={newOneTimeGroup||""} onChange={e=>setNewOneTimeGroup(e.target.value||null)} style={s.select}>
                    <option value="">— Grubsuz —</option>
                    {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <span style={{fontSize:12,color:"#a07050"}}>Son tarih:</span>
                  <input type="date" value={newOneTimeDeadline} onChange={e=>setNewOneTimeDeadline(e.target.value)} style={s.dateInput} />
                  {newOneTimeDeadline&&<button onClick={()=>setNewOneTimeDeadline("")} style={s.clearDate}>✕</button>}
                </div>
                <div style={s.hint}>💡 Yarın otomatik kaybolur</div>
              </>
            )}

            <div style={s.divider} />

            <div>
              <div style={s.noteHeader}>
                <span style={s.noteTitle}>📝 Ortak Günlük Not</span>
                {saving&&<span style={s.savingBadge}>kaydediliyor…</span>}
              </div>
              <textarea value={note} onChange={e=>{setNote(e.target.value);saveNote(e.target.value);}} placeholder="Bugüne özel ortak notunuzu buraya yazın..." style={s.noteArea} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const s = {
  root:{minHeight:"100vh",background:"linear-gradient(135deg,#fdf6ec 0%,#fce7cb 100%)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"32px 16px",fontFamily:"'Georgia','Times New Roman',serif"},
  card:{background:"#fffdf8",borderRadius:16,boxShadow:"0 4px 32px rgba(180,120,60,0.12)",width:"100%",maxWidth:580,padding:"28px 24px",border:"1px solid #f0e4cc"},
  center:{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"},
  spinner:{width:20,height:20,borderRadius:"50%",border:"3px solid #f0e4cc",borderTopColor:"#f59e0b"},
  title:{fontSize:22,fontWeight:700,color:"#2d1f0e"},
  dateLabel:{fontSize:11,color:"#b07040",textTransform:"uppercase",letterSpacing:"1.2px",fontFamily:"monospace"},
  roomPill:{fontSize:11,background:"#fff7ed",border:"1px solid #fed7aa",color:"#ea580c",borderRadius:20,padding:"3px 9px",fontFamily:"monospace",cursor:"pointer",letterSpacing:1,fontWeight:700,userSelect:"none"},
  nameTag:{fontSize:11,color:"#a07050",fontFamily:"monospace"},
  leaveBtn:{background:"none",border:"1px solid #f0e4cc",borderRadius:6,cursor:"pointer",fontSize:11,color:"#c0a080",padding:"2px 7px"},
  viewBtn:{padding:"6px 12px",borderRadius:8,border:"1.5px solid #e5e7eb",background:"#f9fafb",color:"#6b7280",fontSize:12,fontFamily:"inherit",cursor:"pointer",fontWeight:600},
  viewBtnActive:{background:"#fff7ed",borderColor:"#fed7aa",color:"#ea580c"},
  progressWrap:{display:"flex",alignItems:"center",gap:10},
  progressTrack:{flex:1,height:6,background:"#f0e4cc",borderRadius:99,overflow:"hidden"},
  progressFill:{height:"100%",background:"linear-gradient(90deg,#f59e0b,#22c55e)",borderRadius:99,transition:"width 0.4s ease"},
  progressText:{fontSize:12,color:"#a07050",fontFamily:"monospace"},
  taskRow:{display:"flex",alignItems:"flex-start",gap:9,padding:"9px 11px",borderRadius:10,background:"#fff",border:"1px solid #f0e4cc",marginBottom:5},
  orderBtn:{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#a07050",padding:"1px 3px",lineHeight:1,display:"block"},
  checkbox:{width:22,height:22,borderRadius:6,border:"2px solid #d1d5db",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all 0.15s",marginTop:1},
  taskName:{fontSize:14,color:"#2d1f0e",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},
  badge:{fontSize:10,background:"#fff7ed",color:"#ea580c",border:"1px solid #fed7aa",borderRadius:4,padding:"1px 5px",fontFamily:"monospace"},
  byLabel:{fontSize:10,color:"#c0a878",fontFamily:"monospace"},
  editInput:{width:"100%",fontSize:14,color:"#2d1f0e",border:"none",borderBottom:"2px solid #f59e0b",outline:"none",background:"transparent",padding:"2px 0",fontFamily:"inherit",boxSizing:"border-box"},
  actions:{display:"flex",gap:3,opacity:0.4,flexShrink:0},
  iconBtn:{background:"none",border:"none",cursor:"pointer",fontSize:13,padding:"2px 4px",borderRadius:4},
  tabs:{display:"flex",gap:8,marginBottom:10},
  tab:{flex:1,padding:"8px 0",borderRadius:8,border:"1.5px solid #e5e7eb",background:"#f9fafb",color:"#6b7280",fontSize:13,fontFamily:"inherit",cursor:"pointer",fontWeight:600},
  tabGreen:{background:"#f0fdf4",borderColor:"#86efac",color:"#16a34a"},
  tabOrange:{background:"#fff7ed",borderColor:"#fed7aa",color:"#ea580c"},
  addRow:{display:"flex",gap:8,marginBottom:8},
  input:{flex:1,padding:"10px 14px",borderRadius:10,border:"1.5px solid #f0e4cc",fontSize:14,outline:"none",fontFamily:"inherit",background:"#fff",color:"#2d1f0e",boxSizing:"border-box"},
  btn:{padding:"10px 16px",borderRadius:10,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit"},
  select:{padding:"4px 8px",borderRadius:6,border:"1px solid #f0e4cc",fontSize:12,fontFamily:"inherit",color:"#2d1f0e",background:"#fff",outline:"none"},
  dateInput:{padding:"4px 8px",borderRadius:6,border:"1px solid #f0e4cc",fontSize:12,fontFamily:"monospace",color:"#2d1f0e",background:"#fff",outline:"none"},
  clearDate:{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"#c0a080"},
  hint:{fontSize:11,color:"#c0a878",marginBottom:14,fontStyle:"italic",fontFamily:"monospace"},
  divider:{height:1,background:"#f0e4cc",margin:"4px 0 18px"},
  noteHeader:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8},
  noteTitle:{fontSize:14,fontWeight:600,color:"#a07050"},
  savingBadge:{fontSize:11,color:"#b0b0b0",fontStyle:"italic",fontFamily:"monospace"},
  noteArea:{width:"100%",minHeight:80,padding:"12px 14px",borderRadius:10,border:"1.5px solid #f0e4cc",fontSize:14,fontFamily:"'Georgia',serif",color:"#2d1f0e",background:"#fff",resize:"vertical",outline:"none",lineHeight:1.6,boxSizing:"border-box"},
  calNav:{background:"none",border:"1px solid #f0e4cc",borderRadius:8,cursor:"pointer",fontSize:18,color:"#a07050",padding:"2px 12px"},
  calCell:{borderRadius:8,padding:"5px 3px",textAlign:"center",cursor:"pointer",transition:"all 0.12s",minHeight:42,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start"},
};
