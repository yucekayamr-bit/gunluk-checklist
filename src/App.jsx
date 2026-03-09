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
    const s1 = document.createElement("script");
    s1.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js";
    s1.onload = () => {
      const s2 = document.createElement("script");
      s2.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js";
      s2.onload = () => { window._firebaseLoaded = true; resolve(); };
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
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
const TYPE_ROUTINE = "routine", TYPE_ONETIME = "onetime", TYPE_TIMED = "timed";
const TYPE_LABELS = {
  [TYPE_ROUTINE]: { label:"Rutin",       color:"#22c55e", bg:"#f0fdf4", border:"#86efac" },
  [TYPE_ONETIME]: { label:"Bugüne Özel", color:"#ea580c", bg:"#fff7ed", border:"#fed7aa" },
  [TYPE_TIMED]:   { label:"Süreli",      color:"#3b82f6", bg:"#eff6ff", border:"#93c5fd" },
};
const DEPOTS = [
  { id:"merkez", label:"Merkez Depo",  icon:"🏢" },
  { id:"bahce",  label:"Bahçe Deposu", icon:"🌿" },
];

function getFirstDayOfMonth(y,m){let d=new Date(y,m,1).getDay();return d===0?6:d-1;}
function getDaysInMonth(y,m){return new Date(y,m+1,0).getDate();}
const fmtDate = d => new Date(d+"T00:00:00").toLocaleDateString("tr-TR",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
const dayStr  = (y,m,d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
const isToday = (y,m,d) => { const t=new Date(); return t.getFullYear()===y&&t.getMonth()===m&&t.getDate()===d; };

// ─────────────────────────────────────────────
// computeWarnings — pure function, no hooks
// ─────────────────────────────────────────────
function computeWarnings({ products, packageTypes, stock, stockAlerts, productAlertEnabled, orders }) {
  const warnings = [];

  Object.values(packageTypes).forEach(pkg => {
    const product = products[pkg.productId];
    if (!product) return;
    // skip if product-level alert disabled
    if (productAlertEnabled[pkg.productId] === false) return;

    DEPOTS.forEach(depot => {
      const current = stock[depot.id]?.[pkg.id] ?? 0;
      const minAmt  = stockAlerts[pkg.id]?.[depot.id];
      if (minAmt === undefined) return;
      if (current <= minAmt) {
        const orderId = `${pkg.id}_${depot.id}`;
        const order   = orders[orderId];
        warnings.push({
          id: orderId,
          type: "product",
          pkgId: pkg.id, depotId: depot.id, productId: pkg.productId,
          productName: product.name,
          pkgLabel: pkg.label, unit: pkg.unit || "adet",
          isBahce: depot.id === "bahce",
          current, min: minAmt,
          ordered: !!order,
          orderNote: order?.note || "",
        });
      }
    });
  });

  return warnings;
}

// ─────────────────────────────────────────────
// computeRuleWarnings
// rules: { id: { id, name, metric:"kg"|"adet", threshold, pkgIds:[], depotId:"merkez"|"bahce"|"both" } }
// ─────────────────────────────────────────────
function computeRuleWarnings({ rules, packageTypes, stock, orders }) {
  const warnings = [];
  Object.values(rules || {}).forEach(rule => {
    if (!rule.pkgIds || !rule.pkgIds.length) return;
    let total = 0;
    rule.pkgIds.forEach(pkgId => {
      const pkg = packageTypes[pkgId];
      if (!pkg) return;
      const depots = rule.depotId === "both" ? ["merkez","bahce"] : [rule.depotId];
      depots.forEach(depotId => {
        const cnt = stock[depotId]?.[pkgId] ?? 0;
        if (rule.metric === "kg") total += cnt * (pkg.kg || 1);
        else total += cnt;
      });
    });
    if (total <= rule.threshold) {
      const orderId = `rule_${rule.id}`;
      const order   = orders[orderId];
      warnings.push({
        id: orderId,
        type: "rule",
        ruleId: rule.id,
        ruleName: rule.name,
        metric: rule.metric,
        total: Math.round(total * 10) / 10,
        threshold: rule.threshold,
        ordered: !!order,
        orderNote: order?.note || "",
      });
    }
  });
  return warnings;
}

// ─────────────────────────────────────────────
// ACTIVE ALERTS BANNER  (shown in all tabs)
// ─────────────────────────────────────────────
function AlertsBanner({ warnings, ruleWarnings, onOrder, onGoStock }) {
  const all = [...warnings, ...ruleWarnings];
  if (!all.length) return null;
  const active = all.filter(w => !w.ordered);
  const ordered = all.filter(w => w.ordered);

  return (
    <div style={{marginBottom:14}}>
      {active.map(w => (
        <div key={w.id} style={{
          display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8,
          padding:"10px 14px", borderRadius:10, marginBottom:6, fontSize:12, lineHeight:1.6,
          background: w.type==="rule" ? "#fef9c3" : w.isBahce ? "#fff7ed" : "#fef2f2",
          border: `1.5px solid ${w.type==="rule" ? "#fde047" : w.isBahce ? "#fed7aa" : "#fecaca"}`,
        }}>
          <div>
            <div style={{fontWeight:700, color: w.type==="rule"?"#713f12":w.isBahce?"#92400e":"#991b1b"}}>
              {w.type==="rule" ? "📊 Kural Uyarısı" : w.isBahce ? "🌿 Bahçe Deposu Azaldı" : "🏢 Merkez Depo Azaldı"}
            </div>
            {w.type==="rule"
              ? <div style={{color:"#78350f"}}>{w.ruleName}: toplam <strong>{w.total} {w.metric}</strong> kaldı (eşik: {w.threshold} {w.metric})</div>
              : <div style={{color:w.isBahce?"#92400e":"#991b1b"}}>{w.productName} — {w.pkgLabel}: <strong>{w.current}</strong> kaldı (eşik: {w.min})</div>
            }
            {!w.isBahce && w.type!=="rule" && <div style={{fontSize:11,opacity:0.75}}>👉 Temin edilmesi gerekiyor</div>}
            {w.isBahce && <div style={{fontSize:11,opacity:0.75}}>👉 Merkez depodan getirin</div>}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
            {(!w.isBahce || w.type==="rule") && (
              <button onClick={()=>onOrder(w)} style={{...s.btn,background:"#3b82f6",padding:"4px 10px",fontSize:11,whiteSpace:"nowrap"}}>📦 Sipariş Ver</button>
            )}
            <button onClick={onGoStock} style={{...s.btn,background:"#e5e7eb",color:"#6b7280",padding:"4px 10px",fontSize:11}}>Stoka Git</button>
          </div>
        </div>
      ))}
      {ordered.map(w => (
        <div key={w.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"7px 14px",borderRadius:10,marginBottom:6,fontSize:12,background:"#f0fdf4",border:"1px solid #86efac"}}>
          <div>
            <span style={{color:"#166534",fontWeight:600}}>📦 Sipariş Bekleniyor</span>
            <span style={{color:"#4b7c5f",marginLeft:8}}>{w.type==="rule" ? w.ruleName : `${w.productName} — ${w.pkgLabel}`}</span>
            {w.orderNote && <span style={{color:"#86a899",marginLeft:6,fontStyle:"italic"}}>({w.orderNote})</span>}
          </div>
          <span style={{fontSize:10,color:"#86efac",fontFamily:"monospace"}}>stok artınca kapanır</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// ORDER MODAL
// ─────────────────────────────────────────────
function OrderModal({ warning, onConfirm, onClose }) {
  const [note, setNote] = useState("");
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e=>e.stopPropagation()}>
        <div style={{fontWeight:700,fontSize:15,color:"#2d1f0e",marginBottom:4}}>📦 Sipariş Ver</div>
        <div style={{fontSize:13,color:"#a07050",marginBottom:12}}>
          {warning.type==="rule" ? warning.ruleName : `${warning.productName} — ${warning.pkgLabel}`}
        </div>
        <input
          autoFocus value={note} onChange={e=>setNote(e.target.value)}
          placeholder="Sipariş notu (opsiyonel)"
          style={{...s.input,marginBottom:12}}
          onKeyDown={e=>e.key==="Enter"&&onConfirm(note)}
        />
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>onConfirm(note)} style={{...s.btn,background:"#3b82f6",flex:1}}>✅ Siparişi Onayla</button>
          <button onClick={onClose} style={{...s.btn,background:"#e5e7eb",color:"#6b7280"}}>İptal</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// STOCK TAB
// ─────────────────────────────────────────────
function StockTab({ roomCode, products, packageTypes, stock, stockAlerts, productAlertEnabled, rules, warnings, ruleWarnings, orders, onOrder }) {
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productName, setProductName]       = useState("");
  const [productNote, setProductNote]       = useState("");
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [showAddPkg, setShowAddPkg]           = useState(null);
  const [pkgLabel, setPkgLabel]               = useState("");
  const [pkgKg, setPkgKg]                     = useState("");
  const [pkgUnit, setPkgUnit]                 = useState("adet");

  // Rules
  const [showAddRule, setShowAddRule]     = useState(false);
  const [ruleName, setRuleName]           = useState("");
  const [ruleMetric, setRuleMetric]       = useState("kg");
  const [ruleThreshold, setRuleThreshold] = useState("");
  const [ruleDepot, setRuleDepot]         = useState("both");
  const [rulePkgIds, setRulePkgIds]       = useState([]);

  const rp = () => `rooms/${roomCode}`;
  const db = () => getDB();

  const addProduct = async () => {
    const name = productName.trim(); if (!name) return;
    const id = `p-${Date.now()}`;
    await db().ref(`${rp()}/products/${id}`).set({ id, name, note: productNote.trim()||null, createdAt: Date.now() });
    await db().ref(`${rp()}/productAlertEnabled/${id}`).set(true);
    setProductName(""); setProductNote(""); setShowAddProduct(false); setExpandedProduct(id);
  };

  const deleteProduct = async pid => {
    await db().ref(`${rp()}/products/${pid}`).remove();
    await db().ref(`${rp()}/productAlertEnabled/${pid}`).remove();
    const relPkgs = Object.values(packageTypes).filter(p=>p.productId===pid);
    const batch = {};
    relPkgs.forEach(p => {
      batch[`${rp()}/packageTypes/${p.id}`] = null;
      DEPOTS.forEach(d => { batch[`${rp()}/stock/${d.id}/${p.id}`]=null; batch[`${rp()}/stockAlerts/${p.id}/${d.id}`]=null; });
    });
    if (Object.keys(batch).length) await db().ref().update(batch);
  };

  const toggleProductAlert = async pid => {
    const cur = productAlertEnabled[pid] !== false;
    await db().ref(`${rp()}/productAlertEnabled/${pid}`).set(!cur);
  };

  const addPkg = async productId => {
    const label = pkgLabel.trim(); if (!label) return;
    const id = `pk-${Date.now()}`;
    await db().ref(`${rp()}/packageTypes/${id}`).set({ id, productId, label, kg: pkgKg?parseFloat(pkgKg):null, unit: pkgUnit||"adet" });
    const batch = {}; DEPOTS.forEach(d => { batch[`${rp()}/stock/${d.id}/${id}`]=0; });
    await db().ref().update(batch);
    setPkgLabel(""); setPkgKg(""); setPkgUnit("adet"); setShowAddPkg(null);
  };

  const deletePkg = async pkgId => {
    await db().ref(`${rp()}/packageTypes/${pkgId}`).remove();
    const batch = {}; DEPOTS.forEach(d => { batch[`${rp()}/stock/${d.id}/${pkgId}`]=null; batch[`${rp()}/stockAlerts/${pkgId}/${d.id}`]=null; });
    await db().ref().update(batch);
  };

  const updateStock = async (depotId, pkgId, delta) => {
    const current = stock[depotId]?.[pkgId] ?? 0;
    const next = Math.max(0, current + delta);
    await db().ref(`${rp()}/stock/${depotId}/${pkgId}`).set(next);
    // Auto-cancel order if stock increased
    if (delta > 0) {
      const orderId = `${pkgId}_${depotId}`;
      if (orders[orderId]) {
        const minAmt = stockAlerts[pkgId]?.[depotId];
        if (minAmt === undefined || next > minAmt) {
          await db().ref(`${rp()}/orders/${orderId}`).remove();
        }
      }
      // also check rule orders
      Object.values(rules||{}).forEach(async rule => {
        if (!rule.pkgIds?.includes(pkgId)) return;
        const orderId2 = `rule_${rule.id}`;
        if (orders[orderId2]) await db().ref(`${rp()}/orders/${orderId2}`).remove();
      });
    }
  };

  const setStockDirect = async (depotId, pkgId, val) => {
    const n = parseInt(val); if (isNaN(n)||n<0) return;
    const prev = stock[depotId]?.[pkgId] ?? 0;
    await db().ref(`${rp()}/stock/${depotId}/${pkgId}`).set(n);
    if (n > prev) {
      const orderId = `${pkgId}_${depotId}`;
      if (orders[orderId]) {
        const minAmt = stockAlerts[pkgId]?.[depotId];
        if (minAmt === undefined || n > minAmt) await db().ref(`${rp()}/orders/${orderId}`).remove();
      }
      Object.values(rules||{}).forEach(async rule => {
        if (!rule.pkgIds?.includes(pkgId)) return;
        await db().ref(`${rp()}/orders/rule_${rule.id}`).remove();
      });
    }
  };

  const setAlert = async (pkgId, depotId, val) => {
    const n = parseInt(val);
    if (isNaN(n)||n<0) { await db().ref(`${rp()}/stockAlerts/${pkgId}/${depotId}`).remove(); return; }
    await db().ref(`${rp()}/stockAlerts/${pkgId}/${depotId}`).set(n);
  };

  const addRule = async () => {
    const name = ruleName.trim(); if (!name||!ruleThreshold||!rulePkgIds.length) return;
    const id = `r-${Date.now()}`;
    await db().ref(`${rp()}/rules/${id}`).set({ id, name, metric: ruleMetric, threshold: parseFloat(ruleThreshold), depotId: ruleDepot, pkgIds: rulePkgIds });
    setRuleName(""); setRuleThreshold(""); setRulePkgIds([]); setShowAddRule(false);
  };

  const deleteRule = async id => { await db().ref(`${rp()}/rules/${id}`).remove(); await db().ref(`${rp()}/orders/rule_${id}`).remove(); };

  const toggleRulePkg = pkgId => setRulePkgIds(prev => prev.includes(pkgId) ? prev.filter(p=>p!==pkgId) : [...prev, pkgId]);

  const allPkgs = Object.values(packageTypes);
  const productList = Object.values(products).sort((a,b)=>a.createdAt-b.createdAt);
  const allWarnings = [...warnings, ...ruleWarnings];
  const orderedList = allWarnings.filter(w=>w.ordered);

  return (
    <div>
      {/* Ordered items panel */}
      {orderedList.length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:"#166534",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.5px"}}>📦 Sipariş Bekleyenler</div>
          {orderedList.map(w=>(
            <div key={w.id} style={{padding:"8px 14px",borderRadius:10,background:"#f0fdf4",border:"1px solid #86efac",marginBottom:6,fontSize:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <span style={{fontWeight:600,color:"#166534"}}>{w.type==="rule"?w.ruleName:`${w.productName} — ${w.pkgLabel}`}</span>
                {w.orderNote&&<span style={{color:"#4b7c5f",marginLeft:8,fontStyle:"italic"}}>({w.orderNote})</span>}
              </div>
              <span style={{fontSize:10,color:"#86efac",fontFamily:"monospace"}}>stok artınca kapanır</span>
            </div>
          ))}
        </div>
      )}

      {/* Active warnings */}
      {allWarnings.filter(w=>!w.ordered).length > 0 && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:"#991b1b",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.5px"}}>🔔 Aktif Uyarılar</div>
          {allWarnings.filter(w=>!w.ordered).map(w=>(
            <div key={w.id} style={{padding:"10px 14px",borderRadius:10,marginBottom:6,fontSize:12,background:w.type==="rule"?"#fef9c3":w.isBahce?"#fff7ed":"#fef2f2",border:`1.5px solid ${w.type==="rule"?"#fde047":w.isBahce?"#fed7aa":"#fecaca"}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
              <div>
                <div style={{fontWeight:700,color:w.type==="rule"?"#713f12":w.isBahce?"#92400e":"#991b1b",marginBottom:2}}>
                  {w.type==="rule"?"📊 Kural Uyarısı":w.isBahce?"🌿 Bahçe Deposu":"🏢 Merkez Depo"}
                </div>
                {w.type==="rule"
                  ?<div>{w.ruleName}: toplam <strong>{w.total} {w.metric}</strong> (eşik: {w.threshold})</div>
                  :<div>{w.productName} — {w.pkgLabel}: <strong>{w.current}</strong> kaldı (eşik: {w.min})</div>
                }
              </div>
              {(!w.isBahce||w.type==="rule")&&(
                <button onClick={()=>onOrder(w)} style={{...s.btn,background:"#3b82f6",padding:"4px 10px",fontSize:11,flexShrink:0}}>📦 Sipariş Ver</button>
              )}
            </div>
          ))}
        </div>
      )}

      {allWarnings.length===0&&productList.length>0&&(
        <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#166534"}}>✅ Tüm stoklar yeterli seviyede</div>
      )}

      {/* Products */}
      {productList.map(product => {
        const pkgs = Object.values(packageTypes).filter(p=>p.productId===product.id);
        const isExpanded = expandedProduct===product.id;
        const alertOn = productAlertEnabled[product.id] !== false;
        const productWarnings = warnings.filter(w=>w.productId===product.id&&!w.ordered);

        return (
          <div key={product.id} style={{...s.productCard, borderColor: productWarnings.length>0?"#fca5a5":"#f0e4cc"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{flex:1,cursor:"pointer",display:"flex",alignItems:"center",gap:8}} onClick={()=>setExpandedProduct(isExpanded?null:product.id)}>
                <span style={{fontWeight:700,fontSize:15,color:"#2d1f0e"}}>📦 {product.name}</span>
                {product.note&&<span style={{fontSize:11,color:"#a07050"}}>{product.note}</span>}
                {productWarnings.length>0&&<span style={{fontSize:11,background:"#fef2f2",border:"1px solid #fecaca",color:"#ef4444",borderRadius:20,padding:"1px 8px",fontWeight:700}}>⚠️ {productWarnings.length}</span>}
              </div>
              {/* Alert toggle */}
              <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                <span style={{fontSize:11,color:"#a07050"}}>Uyarı</span>
                <button onClick={()=>toggleProductAlert(product.id)} style={{
                  width:36,height:20,borderRadius:10,border:"none",cursor:"pointer",position:"relative",
                  background:alertOn?"#22c55e":"#d1d5db",transition:"background 0.2s",flexShrink:0,
                }}>
                  <div style={{position:"absolute",top:2,left:alertOn?18:2,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s"}}/>
                </button>
                <button onClick={e=>{e.stopPropagation();deleteProduct(product.id);}} style={{...s.iconBtn,opacity:0.4}}>🗑️</button>
                <span style={{color:"#a07050",fontSize:13,cursor:"pointer"}} onClick={()=>setExpandedProduct(isExpanded?null:product.id)}>{isExpanded?"▼":"▶"}</span>
              </div>
            </div>

            {isExpanded&&(
              <div style={{marginTop:14}}>
                {pkgs.length>0&&(
                  <div style={{overflowX:"auto",marginBottom:14}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead>
                        <tr style={{background:"#f9f5ef"}}>
                          <th style={s.th}>Paket</th>
                          {DEPOTS.map(d=><th key={d.id} style={{...s.th,textAlign:"center"}}>{d.icon} {d.label}</th>)}
                          <th style={{...s.th,textAlign:"center"}}>Uyarı Eşiği</th>
                          <th style={s.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pkgs.map(pkg=>(
                          <tr key={pkg.id} style={{borderBottom:"1px solid #f0e4cc"}}>
                            <td style={{...s.td,fontWeight:600}}>
                              {pkg.label}
                              {pkg.kg&&<span style={{fontSize:10,color:"#a07050",marginLeft:4}}>{pkg.kg}kg</span>}
                            </td>
                            {DEPOTS.map(depot=>{
                              const cnt = stock[depot.id]?.[pkg.id] ?? 0;
                              const minAmt = stockAlerts[pkg.id]?.[depot.id];
                              const isLow = alertOn && minAmt!==undefined && cnt<=minAmt;
                              return (
                                <td key={depot.id} style={{...s.td,textAlign:"center"}}>
                                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                                    <button onClick={()=>updateStock(depot.id,pkg.id,-1)} style={s.stockBtn}>−</button>
                                    <input type="number" min="0" value={cnt} onChange={e=>setStockDirect(depot.id,pkg.id,e.target.value)}
                                      style={{...s.stockInput,borderColor:isLow?"#ef4444":"#f0e4cc",color:isLow?"#ef4444":"#2d1f0e",fontWeight:isLow?700:400}}/>
                                    <button onClick={()=>updateStock(depot.id,pkg.id,1)} style={s.stockBtn}>+</button>
                                  </div>
                                  {isLow&&<div style={{fontSize:10,color:"#ef4444",marginTop:2}}>⚠️ düşük</div>}
                                </td>
                              );
                            })}
                            <td style={{...s.td,textAlign:"center"}}>
                              <div style={{display:"flex",gap:6,justifyContent:"center",flexWrap:"wrap"}}>
                                {DEPOTS.map(depot=>(
                                  <div key={depot.id} style={{display:"flex",alignItems:"center",gap:3}}>
                                    <span style={{fontSize:10,color:"#a07050"}}>{depot.icon}≤</span>
                                    <input type="number" min="0" placeholder="—"
                                      value={stockAlerts[pkg.id]?.[depot.id]??""}
                                      onChange={e=>setAlert(pkg.id,depot.id,e.target.value)}
                                      style={s.alertInput}/>
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td style={s.td}>
                              <button onClick={()=>deletePkg(pkg.id)} style={{...s.iconBtn,opacity:0.4,fontSize:11}}>🗑️</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {showAddPkg===product.id?(
                  <div style={{background:"#f9f5ef",borderRadius:10,padding:12,marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:600,color:"#a07050",marginBottom:8}}>Yeni Paket Tipi</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                      <input value={pkgLabel} onChange={e=>setPkgLabel(e.target.value)} placeholder='Etiket (örn: "15kg torba")' style={{...s.input,flex:2,fontSize:13,padding:"7px 10px"}}/>
                      <input value={pkgKg} onChange={e=>setPkgKg(e.target.value)} placeholder="Kg" type="number" min="0" style={{...s.input,width:70,fontSize:13,padding:"7px 10px"}}/>
                      <select value={pkgUnit} onChange={e=>setPkgUnit(e.target.value)} style={s.select}>
                        <option>adet</option><option>torba</option><option>kutu</option><option>paket</option><option>kg</option>
                      </select>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>addPkg(product.id)} style={{...s.btn,background:"#22c55e",padding:"7px 14px",fontSize:13}}>+ Ekle</button>
                      <button onClick={()=>setShowAddPkg(null)} style={{...s.btn,background:"#e5e7eb",color:"#6b7280",padding:"7px 14px",fontSize:13}}>İptal</button>
                    </div>
                  </div>
                ):(
                  <button onClick={()=>setShowAddPkg(product.id)} style={{...s.btn,background:"#f0fdf4",color:"#22c55e",border:"1.5px dashed #86efac",fontSize:12,padding:"6px 14px"}}>+ Paket Tipi Ekle</button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {showAddProduct?(
        <div style={{...s.productCard,background:"#f9f5ef"}}>
          <div style={{fontSize:13,fontWeight:600,color:"#a07050",marginBottom:10}}>Yeni Ürün</div>
          <input value={productName} onChange={e=>setProductName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addProduct()} placeholder="Ürün adı (örn: Kuru Mama)" style={{...s.input,marginBottom:8}}/>
          <input value={productNote} onChange={e=>setProductNote(e.target.value)} placeholder="Not (opsiyonel)" style={{...s.input,marginBottom:12,fontSize:13}}/>
          <div style={{display:"flex",gap:8}}>
            <button onClick={addProduct} style={{...s.btn,background:"#22c55e"}}>+ Ekle</button>
            <button onClick={()=>{setShowAddProduct(false);setProductName("");setProductNote("");}} style={{...s.btn,background:"#e5e7eb",color:"#6b7280"}}>İptal</button>
          </div>
        </div>
      ):(
        <button onClick={()=>setShowAddProduct(true)} style={{...s.btn,background:"#f0fdf4",color:"#22c55e",border:"1.5px dashed #86efac",width:"100%",marginTop:4}}>+ Yeni Ürün Ekle</button>
      )}

      {/* Rules section */}
      <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid #f0e4cc"}}>
        <div style={{fontWeight:700,fontSize:13,color:"#2d1f0e",marginBottom:12}}>📊 Toplam Uyarı Kuralları</div>

        {Object.values(rules||{}).map(rule=>{
          const rw = ruleWarnings.find(w=>w.ruleId===rule.id);
          return (
            <div key={rule.id} style={{...s.productCard,background:rw&&!rw.ordered?"#fef9c3":rw?.ordered?"#f0fdf4":"#fff",borderColor:rw&&!rw.ordered?"#fde047":rw?.ordered?"#86efac":"#f0e4cc",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <span style={{fontWeight:600,color:"#2d1f0e"}}>{rule.name}</span>
                  <span style={{fontSize:11,color:"#a07050",marginLeft:8}}>
                    {rule.depotId==="both"?"Her iki depo":DEPOTS.find(d=>d.id===rule.depotId)?.label} · toplam {rule.metric} ≤ {rule.threshold}
                  </span>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {rw&&!rw.ordered&&<button onClick={()=>onOrder(rw)} style={{...s.btn,background:"#3b82f6",padding:"4px 10px",fontSize:11}}>📦 Sipariş Ver</button>}
                  {rw?.ordered&&<span style={{fontSize:11,color:"#22c55e",fontWeight:600}}>📦 Bekleniyor</span>}
                  <button onClick={()=>deleteRule(rule.id)} style={{...s.iconBtn,opacity:0.4}}>🗑️</button>
                </div>
              </div>
              <div style={{fontSize:11,color:"#a07050",marginTop:4}}>
                Paketler: {rule.pkgIds.map(id=>{const p=packageTypes[id];return p?p.label:"?"}).join(", ")}
              </div>
            </div>
          );
        })}

        {showAddRule?(
          <div style={{...s.productCard,background:"#f9f5ef"}}>
            <div style={{fontSize:12,fontWeight:600,color:"#a07050",marginBottom:10}}>Yeni Kural</div>
            <input value={ruleName} onChange={e=>setRuleName(e.target.value)} placeholder="Kural adı (örn: Toplam mama stoğu)" style={{...s.input,marginBottom:8,fontSize:13}}/>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8,alignItems:"center"}}>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <span style={{fontSize:11,color:"#a07050"}}>Birim</span>
                <select value={ruleMetric} onChange={e=>setRuleMetric(e.target.value)} style={s.select}>
                  <option value="kg">kg (toplam)</option>
                  <option value="adet">adet (toplam)</option>
                </select>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <span style={{fontSize:11,color:"#a07050"}}>Eşik değeri</span>
                <input value={ruleThreshold} onChange={e=>setRuleThreshold(e.target.value)} type="number" min="0" placeholder="örn: 50" style={{...s.input,width:100,fontSize:13,padding:"7px 10px"}}/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <span style={{fontSize:11,color:"#a07050"}}>Depo</span>
                <select value={ruleDepot} onChange={e=>setRuleDepot(e.target.value)} style={s.select}>
                  <option value="both">Her ikisi</option>
                  <option value="merkez">🏢 Merkez</option>
                  <option value="bahce">🌿 Bahçe</option>
                </select>
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,color:"#a07050",marginBottom:6}}>Hangi paketler dahil edilsin?</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {allPkgs.map(pkg=>{
                  const product = products[pkg.productId];
                  const sel = rulePkgIds.includes(pkg.id);
                  return (
                    <button key={pkg.id} onClick={()=>toggleRulePkg(pkg.id)} style={{
                      padding:"4px 10px",borderRadius:8,border:"1.5px solid",fontSize:12,cursor:"pointer",fontFamily:"inherit",
                      background:sel?"#eff6ff":"#f9fafb",borderColor:sel?"#3b82f6":"#e5e7eb",color:sel?"#1d4ed8":"#6b7280",fontWeight:sel?700:400,
                    }}>
                      {product?.name} — {pkg.label}{pkg.kg?` (${pkg.kg}kg)`:""}
                    </button>
                  );
                })}
                {allPkgs.length===0&&<span style={{fontSize:12,color:"#c0a080",fontStyle:"italic"}}>Önce ürün ve paket tipi ekleyin</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={addRule} style={{...s.btn,background:"#f59e0b",padding:"7px 14px",fontSize:13}}>+ Kural Ekle</button>
              <button onClick={()=>setShowAddRule(false)} style={{...s.btn,background:"#e5e7eb",color:"#6b7280",padding:"7px 14px",fontSize:13}}>İptal</button>
            </div>
          </div>
        ):(
          <button onClick={()=>setShowAddRule(true)} style={{...s.btn,background:"#fffbeb",color:"#92400e",border:"1.5px dashed #fcd34d",width:"100%",fontSize:13}}>+ Yeni Toplam Uyarı Kuralı</button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CALENDAR TAB
// ─────────────────────────────────────────────
function CalendarTab({ tasks, issues, checked, warnings, ruleWarnings }) {
  const today = new Date();
  const [calYear, setCalYear]     = useState(today.getFullYear());
  const [calMonth, setCalMonth]   = useState(today.getMonth());
  const [calFilter, setCalFilter] = useState("all");
  const [detailDay, setDetailDay] = useState(null);

  const allWarnings = [...warnings, ...ruleWarnings];
  const issueDates    = Object.values(issues).map(i=>i.reportedAt).filter(Boolean);
  const deadlineDates = tasks.filter(t=>t.type===TYPE_TIMED&&t.deadline).map(t=>t.deadline);

  const dim = getDaysInMonth(calYear,calMonth);
  const fd  = getFirstDayOfMonth(calYear,calMonth);
  const cells = [...Array(fd).fill(null), ...Array.from({length:dim},(_,i)=>i+1)];

  const detailIssues    = detailDay ? Object.entries(issues).filter(([,v])=>v.reportedAt===detailDay) : [];
  const detailDeadlines = detailDay ? tasks.filter(t=>t.deadline===detailDay&&t.type===TYPE_TIMED) : [];
  const detailWarnings  = detailDay===todayStr() ? allWarnings : [];

  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
        {[
          {key:"all",       label:"Tümü",          color:"#6b7280"},
          {key:"issues",    label:"⚠️ Hatalar",     color:"#ef4444"},
          {key:"warnings",  label:"🔔 Stok",        color:"#f59e0b"},
          {key:"deadlines", label:"⏳ Deadlineler",  color:"#3b82f6"},
        ].map(f=>(
          <button key={f.key} onClick={()=>setCalFilter(f.key)} style={{
            padding:"5px 12px",borderRadius:20,border:"1.5px solid",fontSize:12,cursor:"pointer",fontFamily:"inherit",
            fontWeight:calFilter===f.key?700:400,
            background:calFilter===f.key?"#2d1f0e":"#fff",
            borderColor:calFilter===f.key?"#2d1f0e":f.color,
            color:calFilter===f.key?"#fff":f.color,
          }}>{f.label}</button>
        ))}
      </div>

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
          const ds = dayStr(calYear,calMonth,d);
          const hasIssue    = issueDates.includes(ds);
          const hasDeadline = deadlineDates.includes(ds);
          const hasWarning  = ds===todayStr() && allWarnings.length>0;
          const isTod = isToday(calYear,calMonth,d), isSel = ds===detailDay;
          const show = calFilter==="all"||(calFilter==="issues"&&hasIssue)||(calFilter==="warnings"&&hasWarning)||(calFilter==="deadlines"&&hasDeadline);
          return (
            <div key={ds} onClick={()=>setDetailDay(prev=>prev===ds?null:ds)} style={{
              ...s.calCell,
              background:isSel?"#2d1f0e":isTod?"#fff7ed":"#fff",
              border:isTod&&!isSel?"2px solid #f59e0b":"1px solid #f0e4cc",
              color:isSel?"#fff":"#2d1f0e",
              opacity:(!show&&calFilter!=="all")?0.2:1,
            }}>
              <div style={{fontWeight:isTod||isSel?700:400,fontSize:13}}>{d}</div>
              <div style={{display:"flex",gap:2,marginTop:2,justifyContent:"center"}}>
                {hasIssue    &&(calFilter==="all"||calFilter==="issues")    &&<div style={{width:5,height:5,borderRadius:"50%",background:isSel?"rgba(255,255,255,0.8)":"#ef4444"}}/>}
                {hasDeadline &&(calFilter==="all"||calFilter==="deadlines") &&<div style={{width:5,height:5,borderRadius:"50%",background:isSel?"rgba(255,255,255,0.8)":"#3b82f6"}}/>}
                {hasWarning  &&(calFilter==="all"||calFilter==="warnings")  &&<div style={{width:5,height:5,borderRadius:"50%",background:isSel?"rgba(255,255,255,0.8)":"#f59e0b"}}/>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{display:"flex",gap:12,justifyContent:"center",fontSize:11,color:"#a07050",fontFamily:"monospace",margin:"10px 0 14px"}}>
        <span>🔴 hata</span><span>🔵 deadline</span><span>🟡 stok uyarısı</span>
      </div>

      {detailDay&&(
        <div style={{background:"#f9f5ef",borderRadius:12,padding:16,border:"1px solid #f0e4cc"}}>
          <div style={{fontWeight:700,fontSize:14,color:"#2d1f0e",marginBottom:12}}>{fmtDate(detailDay)}</div>
          {detailIssues.length===0&&detailDeadlines.length===0&&detailWarnings.length===0&&(
            <div style={{color:"#c0a080",fontSize:13,fontStyle:"italic"}}>Bu gün için kayıt yok.</div>
          )}
          {detailIssues.length>0&&(
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:700,color:"#ef4444",marginBottom:6}}>⚠️ Hatalar</div>
              {detailIssues.map(([tid,issue])=>{
                const task=tasks.find(t=>t.id===tid);
                return <div key={tid} style={{fontSize:12,color:"#ef4444",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"6px 10px",marginBottom:4}}><strong>{task?.name||"?"}</strong>: {issue.reason}<span style={{color:"#fca5a5",marginLeft:4}}>— {issue.by}</span></div>;
              })}
            </div>
          )}
          {detailDeadlines.length>0&&(
            <div style={{marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:700,color:"#3b82f6",marginBottom:6}}>⏳ Deadlineler</div>
              {detailDeadlines.map(t=>(
                <div key={t.id} style={{fontSize:13,padding:"6px 10px",background:"#eff6ff",borderRadius:6,marginBottom:4,border:"1px solid #93c5fd",display:"flex",justifyContent:"space-between"}}>
                  <span>{t.name}</span>
                  {checked[t.id]&&<span style={{color:"#22c55e",fontSize:11}}>✓ tamamlandı</span>}
                </div>
              ))}
            </div>
          )}
          {detailWarnings.length>0&&(
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#f59e0b",marginBottom:6}}>🔔 Stok Uyarıları</div>
              {detailWarnings.map((w,i)=>(
                <div key={i} style={{padding:"8px 12px",borderRadius:8,border:"1.5px solid",marginBottom:6,fontSize:12,background:w.type==="rule"?"#fef9c3":w.isBahce?"#fff7ed":"#fef2f2",borderColor:w.type==="rule"?"#fde047":w.isBahce?"#fed7aa":"#fecaca"}}>
                  <div style={{fontWeight:700}}>{w.type==="rule"?"📊 "+w.ruleName:w.isBahce?"🌿 Bahçe":"🏢 Merkez"}</div>
                  {w.type==="rule"
                    ?<div>{w.total} {w.metric} kaldı (eşik: {w.threshold})</div>
                    :<div>{w.productName} — {w.pkgLabel}: {w.current} kaldı</div>
                  }
                  {w.ordered&&<div style={{color:"#22c55e",fontSize:11,marginTop:2}}>📦 Sipariş verildi</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [fbReady, setFbReady]     = useState(false);
  const [screen, setScreen]       = useState("lobby");
  const [tab, setTab]             = useState("tasks");
  const [roomCode, setRoomCode]   = useState("");
  const [myName, setMyName]       = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [nameInput, setNameInput] = useState("");

  const [tasks, setTasks]     = useState([]);
  const [groups, setGroups]   = useState([]);
  const [checked, setChecked] = useState({});
  const [issues, setIssues]   = useState({});
  const [note, setNote]       = useState("");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [activeType, setActiveType]     = useState(TYPE_ROUTINE);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [saving, setSaving]   = useState(false);
  const [copyMsg, setCopyMsg] = useState(false);

  const [newName, setNewName]         = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [newGroup, setNewGroup]       = useState(null);
  const [editingId, setEditingId]     = useState(null);
  const [editName, setEditName]       = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editGroup, setEditGroup]     = useState(null);
  const [editType, setEditType]       = useState(TYPE_ROUTINE);
  const [issueTaskId, setIssueTaskId] = useState(null);
  const [issueReason, setIssueReason] = useState("");
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editingGroupName, setEditingGroupName] = useState("");

  const [products, setProducts]                 = useState({});
  const [packageTypes, setPackageTypes]         = useState({});
  const [stock, setStock]                       = useState({});
  const [stockAlerts, setStockAlerts]           = useState({});
  const [productAlertEnabled, setProductAlertEnabled] = useState({});
  const [rules, setRules]                       = useState({});
  const [orders, setOrders]                     = useState({});

  const [orderModalWarning, setOrderModalWarning] = useState(null);

  const listenersRef = useRef([]);

  useEffect(() => {
    loadFirebase().then(()=>setFbReady(true)).catch(console.error);
    const r=localStorage.getItem("cl-room"), n=localStorage.getItem("cl-name");
    if(r&&n){setRoomCode(r);setMyName(n);}
  },[]);

  useEffect(()=>{
    if(!fbReady||!roomCode) return;
    attachListeners(roomCode,myName,selectedDate);
    return ()=>detachListeners();
  },[fbReady,roomCode,myName,selectedDate]);

  const detachListeners = () => { listenersRef.current.forEach(({ref,fn})=>ref.off("value",fn)); listenersRef.current=[]; };

  const attachListeners = (room,name,date) => {
    detachListeners();
    const db=getDB();
    const reg=(ref,fn)=>{ref.on("value",fn);listenersRef.current.push({ref,fn});};
    reg(db.ref(`rooms/${room}/groups`),               snap=>setGroups(snap.val()?Object.values(snap.val()).sort((a,b)=>(a.order||0)-(b.order||0)):[]));
    reg(db.ref(`rooms/${room}/alltasks`),             snap=>setTasks(snap.val()?Object.values(snap.val()).sort((a,b)=>(a.order||0)-(b.order||0)):[]));
    reg(db.ref(`rooms/${room}/notes/${date}`),        snap=>setNote(snap.val()||""));
    reg(db.ref(`rooms/${room}/done/${date}/${name}`), snap=>setChecked(snap.val()||{}));
    reg(db.ref(`rooms/${room}/issues`),               snap=>setIssues(snap.val()||{}));
    reg(db.ref(`rooms/${room}/products`),             snap=>setProducts(snap.val()||{}));
    reg(db.ref(`rooms/${room}/packageTypes`),         snap=>setPackageTypes(snap.val()||{}));
    reg(db.ref(`rooms/${room}/stock`),                snap=>setStock(snap.val()||{}));
    reg(db.ref(`rooms/${room}/stockAlerts`),          snap=>setStockAlerts(snap.val()||{}));
    reg(db.ref(`rooms/${room}/productAlertEnabled`),  snap=>setProductAlertEnabled(snap.val()||{}));
    reg(db.ref(`rooms/${room}/rules`),                snap=>setRules(snap.val()||{}));
    reg(db.ref(`rooms/${room}/orders`),               snap=>setOrders(snap.val()||{}));
    setScreen("app");
  };

  const joinRoom = (code,name) => {
    const c=code.trim().toUpperCase(),n=name.trim(); if(!c||!n) return;
    localStorage.setItem("cl-room",c); localStorage.setItem("cl-name",n);
    setRoomCode(c); setMyName(n);
  };

  const leaveRoom = () => {
    detachListeners(); localStorage.removeItem("cl-room"); localStorage.removeItem("cl-name");
    setRoomCode(""); setMyName(""); setScreen("lobby");
  };

  const rp = () => `rooms/${roomCode}`;
  const db = () => getDB();

  // Compute warnings
  const warnings     = computeWarnings({ products, packageTypes, stock, stockAlerts, productAlertEnabled, orders });
  const ruleWarnings = computeRuleWarnings({ rules, packageTypes, stock, orders });
  const allWarnings  = [...warnings, ...ruleWarnings];
  const activeWarningsCount = allWarnings.filter(w=>!w.ordered).length;
  const orderedCount        = allWarnings.filter(w=>w.ordered).length;

  const handleOrder = async (warning) => { setOrderModalWarning(warning); };
  const confirmOrder = async (note) => {
    if (!orderModalWarning) return;
    await db().ref(`${rp()}/orders/${orderModalWarning.id}`).set({ note, orderedAt: todayStr(), by: myName });
    setOrderModalWarning(null);
  };

  // Visible tasks
  const visibleTasks = tasks.map(t=>({...t, type: t.type||TYPE_ROUTINE})).filter(t=>{
    if(t.type===TYPE_ROUTINE) return true;
    if(t.type===TYPE_ONETIME) return t.date===selectedDate;
    if(t.type===TYPE_TIMED){ if(!t.deadline) return true; return t.deadline>=selectedDate||!checked[t.id]; }
    return true;
  });

  const addTask = async ()=>{
    const name=newName.trim(); if(!name) return;
    const id=`t-${Date.now()}`;
    const gt=tasks.filter(t=>(t.groupId||null)===(newGroup||null)&&t.type===activeType);
    await db().ref(`${rp()}/alltasks/${id}`).set({id,name,by:myName,type:activeType,groupId:newGroup||null,order:gt.length,date:activeType===TYPE_ONETIME?selectedDate:null,deadline:activeType===TYPE_TIMED?(newDeadline||null):null,createdAt:Date.now()});
    setNewName(""); setNewDeadline("");
  };
  const deleteTask  = async id=>{ await db().ref(`${rp()}/alltasks/${id}`).remove(); await db().ref(`${rp()}/done/${selectedDate}/${myName}/${id}`).remove(); await db().ref(`${rp()}/issues/${id}`).remove(); };
  const toggleCheck = async id=>{ await db().ref(`${rp()}/done/${selectedDate}/${myName}/${id}`).set(!checked[id]); };
  const startEdit   = task=>{ setEditingId(task.id);setEditName(task.name);setEditDeadline(task.deadline||"");setEditGroup(task.groupId||null);setEditType(task.type||TYPE_ROUTINE); };
  const saveEdit    = async()=>{ if(!editName.trim()){setEditingId(null);return;} await db().ref(`${rp()}/alltasks/${editingId}`).update({name:editName.trim(),type:editType,groupId:editGroup||null,deadline:editType===TYPE_TIMED?(editDeadline||null):null,date:editType===TYPE_ONETIME?selectedDate:null}); setEditingId(null); };
  const moveTask    = async(taskId,groupId,type,index,dir)=>{ const gt=visibleTasks.filter(t=>(t.groupId||null)===(groupId||null)&&t.type===type); const ni=index+dir; if(ni<0||ni>=gt.length) return; const u=[...gt]; [u[index],u[ni]]=[u[ni],u[index]]; const batch={}; u.forEach((t,i)=>{batch[`${rp()}/alltasks/${t.id}/order`]=i;}); await db().ref().update(batch); };
  const addGroup    = async()=>{ const name=newGroupName.trim(); if(!name) return; const id=`g-${Date.now()}`; await db().ref(`${rp()}/groups/${id}`).set({id,name,color:GROUP_COLORS[groups.length%GROUP_COLORS.length],order:groups.length}); setNewGroupName(""); setShowGroupForm(false); };
  const deleteGroup = async gid=>{ await db().ref(`${rp()}/groups/${gid}`).remove(); const batch={}; tasks.filter(t=>t.groupId===gid).forEach(t=>{batch[`${rp()}/alltasks/${t.id}/groupId`]=null;}); if(Object.keys(batch).length) await db().ref().update(batch); };
  const saveGroupEdit=async gid=>{ if(!editingGroupName.trim()){setEditingGroupId(null);return;} await db().ref(`${rp()}/groups/${gid}`).update({name:editingGroupName.trim()}); setEditingGroupId(null); };
  const moveGroup   = async(index,dir)=>{ const ni=index+dir; if(ni<0||ni>=groups.length) return; const u=[...groups]; [u[index],u[ni]]=[u[ni],u[index]]; const batch={}; u.forEach((g,i)=>{batch[`${rp()}/groups/${g.id}/order`]=i;}); await db().ref().update(batch); };
  const openIssueModal=taskId=>{ setIssueTaskId(taskId); setIssueReason(issues[taskId]?.reason||""); setShowIssueModal(true); };
  const submitIssue=async()=>{ if(!issueTaskId) return; if(!issueReason.trim()) await db().ref(`${rp()}/issues/${issueTaskId}`).remove(); else await db().ref(`${rp()}/issues/${issueTaskId}`).set({reason:issueReason.trim(),by:myName,reportedAt:selectedDate}); setShowIssueModal(false);setIssueReason("");setIssueTaskId(null); };
  const cancelIssue=async taskId=>{ await db().ref(`${rp()}/issues/${taskId}`).remove(); setShowIssueModal(false);setIssueReason("");setIssueTaskId(null); };
  const saveNote    = async v=>{ setSaving(true); await db().ref(`${rp()}/notes/${selectedDate}`).set(v); setTimeout(()=>setSaving(false),700); };
  const copyCode    = ()=>{ navigator.clipboard.writeText(roomCode).catch(()=>{}); setCopyMsg(true); setTimeout(()=>setCopyMsg(false),1500); };
  const toggleCollapse=gid=>setCollapsedGroups(p=>({...p,[gid]:!p[gid]}));

  const deadlineLabel=dl=>{ if(!dl) return null; const diff=Math.ceil((new Date(dl)-new Date(todayStr()))/86400000); if(diff<0) return {text:`${Math.abs(diff)}g gecikti`,color:"#ef4444"}; if(diff===0) return {text:"bugün son!",color:"#f59e0b"}; if(diff===1) return {text:"yarın son",color:"#ea580c"}; return {text:`${diff}g kaldı`,color:"#6b7280"}; };
  const getGroupColor=gid=>groups.find(g=>g.id===gid)?.color||"#e5e7eb";
  const completedCount=visibleTasks.filter(t=>checked[t.id]).length;
  const progress=visibleTasks.length>0?(completedCount/visibleTasks.length)*100:0;

  if(!fbReady) return <div style={s.center}><div style={s.spinner}/><div style={{marginTop:12,color:"#a07050",fontSize:13}}>Bağlanıyor…</div></div>;

  if(screen==="lobby") return (
    <div style={s.root}>
      <div style={{...s.card,maxWidth:400,textAlign:"center"}}>
        <div style={{fontSize:44,marginBottom:8}}>🌿</div>
        <h1 style={s.title}>Bahçe Asistanı</h1>
        <p style={{color:"#a07050",fontSize:14,marginBottom:20,lineHeight:1.6}}>Oda kodu ile arkadaşınızla gerçek zamanlı paylaşın.</p>
        <input value={nameInput} onChange={e=>setNameInput(e.target.value)} placeholder="Adınız" style={{...s.input,marginBottom:10,textAlign:"center"}}/>
        <button onClick={()=>joinRoom(randCode(),nameInput)} style={{...s.btn,background:"#22c55e",width:"100%",marginBottom:10}}>✨ Yeni Oda Oluştur</button>
        <div style={{color:"#c0a080",fontSize:12,margin:"8px 0",fontStyle:"italic"}}>— veya mevcut odaya katıl —</div>
        <div style={{display:"flex",gap:8}}>
          <input value={roomInput} onChange={e=>setRoomInput(e.target.value.toUpperCase())} onKeyDown={e=>e.key==="Enter"&&joinRoom(roomInput,nameInput)} placeholder="ODA KODU" maxLength={8} style={{...s.input,flex:1,textAlign:"center",letterSpacing:3,fontWeight:700}}/>
          <button onClick={()=>joinRoom(roomInput,nameInput)} style={{...s.btn,background:"#f59e0b"}}>Katıl →</button>
        </div>
      </div>
    </div>
  );

  const IssueModal=()=>{ const task=tasks.find(t=>t.id===issueTaskId); const existing=issues[issueTaskId]; return (
    <div style={s.overlay} onClick={()=>setShowIssueModal(false)}>
      <div style={s.modal} onClick={e=>e.stopPropagation()}>
        <div style={{fontWeight:700,fontSize:15,color:"#2d1f0e",marginBottom:4}}>⚠️ Sorun Bildir</div>
        <div style={{fontSize:13,color:"#a07050",marginBottom:12}}>{task?.name}</div>
        {existing&&<div style={s.existingIssue}><div style={{fontSize:11,color:"#ef4444",fontWeight:700,marginBottom:4}}>Mevcut sorun — {existing.by}:</div><div style={{fontSize:13}}>{existing.reason}</div></div>}
        <textarea autoFocus value={issueReason} onChange={e=>setIssueReason(e.target.value)} placeholder="Sorunun nedeni... (boş = iptal)" style={{...s.noteArea,minHeight:70,marginBottom:12}}/>
        <div style={{display:"flex",gap:8}}>
          <button onClick={submitIssue} style={{...s.btn,background:"#ef4444",flex:1}}>{issueReason.trim()?"⚠️ Bildir":"🗑️ İptal Et"}</button>
          {existing&&<button onClick={()=>cancelIssue(issueTaskId)} style={{...s.btn,background:"#6b7280"}}>Kapat</button>}
          <button onClick={()=>setShowIssueModal(false)} style={{...s.btn,background:"#e5e7eb",color:"#6b7280"}}>İptal</button>
        </div>
      </div>
    </div>
  );};

  const TaskRow=({task,index,groupTasks})=>{ const isDone=checked[task.id],dl=task.type===TYPE_TIMED?deadlineLabel(task.deadline):null,typeInfo=TYPE_LABELS[task.type]||TYPE_LABELS[TYPE_ROUTINE],hasIssue=!!issues[task.id],gColor=task.groupId?getGroupColor(task.groupId):null; return (
    <div style={{...s.taskRow,opacity:isDone?0.5:1,borderLeft:`3px solid ${hasIssue?"#ef4444":gColor||typeInfo.border}`,background:hasIssue?"#fff5f5":"#fff"}}>
      <div style={{display:"flex",flexDirection:"column",gap:1,flexShrink:0}}>
        <button onClick={()=>moveTask(task.id,task.groupId,task.type,index,-1)} disabled={index===0} style={{...s.orderBtn,opacity:index===0?0.2:0.6}}>▲</button>
        <button onClick={()=>moveTask(task.id,task.groupId,task.type,index,1)} disabled={index===groupTasks.length-1} style={{...s.orderBtn,opacity:index===groupTasks.length-1?0.2:0.6}}>▼</button>
      </div>
      <button onClick={()=>toggleCheck(task.id)} style={{...s.checkbox,background:isDone?"#22c55e":"transparent",borderColor:isDone?"#22c55e":"#d1d5db"}}>
        {isDone&&<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </button>
      <div style={{flex:1,minWidth:0}}>
        {editingId===task.id?(
          <div>
            <input autoFocus value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveEdit()} style={{...s.editInput,marginBottom:6}}/>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
              <span style={{fontSize:11,color:"#a07050"}}>Tür:</span>
              {Object.entries(TYPE_LABELS).map(([k,v])=>(
                <button key={k} onClick={()=>setEditType(k)} style={{...s.typeChip,background:editType===k?v.bg:"#f9fafb",borderColor:editType===k?v.border:"#e5e7eb",color:editType===k?v.color:"#6b7280",fontWeight:editType===k?700:400}}>{v.label}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
              <span style={{fontSize:11,color:"#a07050"}}>Grup:</span>
              <select value={editGroup||""} onChange={e=>setEditGroup(e.target.value||null)} style={s.select}>
                <option value="">— Grupsuz —</option>
                {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            {editType===TYPE_TIMED&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}><span style={{fontSize:11,color:"#a07050"}}>Son tarih:</span><input type="date" value={editDeadline} onChange={e=>setEditDeadline(e.target.value)} style={s.dateInput}/>{editDeadline&&<button onClick={()=>setEditDeadline("")} style={s.clearDate}>✕</button>}</div>}
            <div style={{display:"flex",gap:6}}>
              <button onClick={saveEdit} style={{...s.btn,fontSize:11,padding:"4px 12px",background:"#22c55e"}}>Kaydet</button>
              <button onClick={()=>setEditingId(null)} style={{...s.btn,fontSize:11,padding:"4px 12px",background:"#e5e7eb",color:"#6b7280"}}>İptal</button>
            </div>
          </div>
        ):(
          <>
            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              <span style={{...s.taskName,textDecoration:isDone?"line-through":"none"}}>{task.name}</span>
              <span style={{...s.typeChip,background:typeInfo.bg,borderColor:typeInfo.border,color:typeInfo.color,fontSize:10,padding:"1px 6px"}}>{typeInfo.label}</span>
            </div>
            {hasIssue&&<div style={s.issueTag}>⚠️ {issues[task.id].reason}<span style={{color:"#fca5a5",marginLeft:4}}>— {issues[task.id].by}</span></div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:2}}>
              {task.by&&<span style={s.byLabel}>ekleyen: {task.by}</span>}
              {dl&&<span style={{...s.byLabel,color:dl.color,fontWeight:600}}>⏰ {dl.text}</span>}
              {task.deadline&&task.type===TYPE_TIMED&&<span style={{...s.byLabel,color:"#b0b8c8"}}>{task.deadline}</span>}
            </div>
          </>
        )}
      </div>
      <div style={s.actions}>
        <button onClick={()=>openIssueModal(task.id)} style={{...s.iconBtn,opacity:hasIssue?1:0.35,fontSize:14}}>⚠️</button>
        <button onClick={()=>startEdit(task)} style={s.iconBtn}>✏️</button>
        <button onClick={()=>deleteTask(task.id)} style={s.iconBtn}>🗑️</button>
      </div>
    </div>
  );};

  const GroupSection=({group,gIndex})=>{ const gid=group?group.id:"__none__"; const gTasks=visibleTasks.filter(t=>(t.groupId||null)===(group?group.id:null)).map(t=>({...t,type:t.type||TYPE_ROUTINE})); if(gTasks.length===0&&group) return null; const doneCount=gTasks.filter(t=>checked[t.id]).length; const issueCount=gTasks.filter(t=>issues[t.id]).length; const isCollapsed=collapsedGroups[gid]; const color=group?group.color:"#9ca3af"; return (
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
        <div style={{width:4,height:20,borderRadius:2,background:color,flexShrink:0}}/>
        {editingGroupId===gid?(
          <input autoFocus value={editingGroupName} onChange={e=>setEditingGroupName(e.target.value)} onBlur={()=>saveGroupEdit(gid)} onKeyDown={e=>e.key==="Enter"&&saveGroupEdit(gid)} style={{...s.editInput,flex:1,fontSize:13}}/>
        ):(
          <span style={{fontWeight:700,fontSize:13,color:"#2d1f0e",flex:1,cursor:"pointer"}} onClick={()=>toggleCollapse(gid)}>
            {group?group.name:"Grupsuz"}
            <span style={{fontWeight:400,fontSize:11,color:"#a07050",marginLeft:6}}>{doneCount}/{gTasks.length}</span>
            {issueCount>0&&<span style={{fontSize:11,color:"#ef4444",marginLeft:6}}>⚠️ {issueCount}</span>}
          </span>
        )}
        <div style={{display:"flex",gap:2,alignItems:"center"}}>
          {group&&(<><button onClick={()=>moveGroup(gIndex,-1)} disabled={gIndex===0} style={{...s.orderBtn,opacity:gIndex===0?0.2:0.5,fontSize:9}}>▲</button><button onClick={()=>moveGroup(gIndex,1)} disabled={gIndex===groups.length-1} style={{...s.orderBtn,opacity:gIndex===groups.length-1?0.2:0.5,fontSize:9}}>▼</button><button onClick={()=>{setEditingGroupId(gid);setEditingGroupName(group.name);}} style={{...s.iconBtn,fontSize:11,opacity:0.5}}>✏️</button><button onClick={()=>deleteGroup(group.id)} style={{...s.iconBtn,fontSize:11,opacity:0.5}}>🗑️</button></>)}
          <button onClick={()=>toggleCollapse(gid)} style={{...s.iconBtn,fontSize:12,opacity:0.5}}>{isCollapsed?"▶":"▼"}</button>
        </div>
      </div>
      {!isCollapsed&&<div style={{paddingLeft:12}}>
        {gTasks.length===0&&<div style={{color:"#c0a080",fontSize:12,fontStyle:"italic",padding:"4px 0"}}>Henüz görev yok</div>}
        {gTasks.filter(t=>t.type===TYPE_ROUTINE).map((t,i,arr)=><TaskRow key={t.id} task={t} index={i} groupTasks={arr}/>)}
        {gTasks.filter(t=>t.type===TYPE_TIMED).map((t,i,arr)=><TaskRow key={t.id} task={t} index={i} groupTasks={arr}/>)}
        {gTasks.filter(t=>t.type===TYPE_ONETIME).map((t,i,arr)=><TaskRow key={t.id} task={t} index={i} groupTasks={arr}/>)}
      </div>}
    </div>
  );};

  const ungroupedVisible=visibleTasks.filter(t=>!t.groupId);

  return (
    <div style={s.root}>
      {showIssueModal&&<IssueModal/>}
      {orderModalWarning&&<OrderModal warning={orderModalWarning} onConfirm={confirmOrder} onClose={()=>setOrderModalWarning(null)}/>}
      <div style={s.card}>
        {/* Top bar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>🌿</span>
            <span style={{fontWeight:700,fontSize:16,color:"#2d1f0e"}}>Bahçe Asistanı</span>
          </div>
          <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
            {Object.keys(issues).length>0&&<span style={s.issuePill}>⚠️ {Object.keys(issues).length}</span>}
            {activeWarningsCount>0&&<span style={s.warnPill}>🔔 {activeWarningsCount}</span>}
            {orderedCount>0&&<span style={s.orderPill}>📦 {orderedCount}</span>}
            <div style={s.roomPill} onClick={copyCode}>🏠 {roomCode} {copyMsg?"✓":"⎘"}</div>
            <span style={s.nameTag}>👤 {myName}</span>
            <button onClick={leaveRoom} style={s.leaveBtn}>✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:6,marginBottom:16}}>
          {[{key:"tasks",label:"📋 Görevler"},{key:"stock",label:"📦 Stok"},{key:"calendar",label:"📅 Takvim"}].map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)} style={{...s.mainTab,background:tab===t.key?"#2d1f0e":"#f9f5ef",color:tab===t.key?"#fff":"#a07050",borderColor:tab===t.key?"#2d1f0e":"#f0e4cc"}}>{t.label}</button>
          ))}
        </div>

        {/* Alerts banner — visible in all tabs */}
        <AlertsBanner
          warnings={warnings}
          ruleWarnings={ruleWarnings}
          onOrder={handleOrder}
          onGoStock={()=>setTab("stock")}
        />

        {/* TASKS */}
        {tab==="tasks"&&(<>
          <div style={{...s.dateLabel,marginBottom:12}}>{fmtDate(selectedDate)}</div>
          {visibleTasks.length>0&&<div style={{...s.progressWrap,marginBottom:16}}><div style={s.progressTrack}><div style={{...s.progressFill,width:`${progress}%`}}/></div><span style={s.progressText}>{completedCount}/{visibleTasks.length}</span></div>}
          <div style={{marginBottom:8}}>
            {ungroupedVisible.length>0&&<GroupSection group={null} gIndex={-1}/>}
            {groups.map((g,i)=><GroupSection key={g.id} group={g} gIndex={i}/>)}
          </div>
          {showGroupForm?(<div style={{display:"flex",gap:8,marginBottom:14}}><input autoFocus value={newGroupName} onChange={e=>setNewGroupName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addGroup()} placeholder="Grup adı..." style={{...s.input,flex:1}}/><button onClick={addGroup} style={{...s.btn,background:"#a855f7",padding:"9px 14px"}}>+ Ekle</button><button onClick={()=>setShowGroupForm(false)} style={{...s.btn,background:"#e5e7eb",color:"#6b7280",padding:"9px 14px"}}>İptal</button></div>):(<button onClick={()=>setShowGroupForm(true)} style={{...s.btn,background:"#f3e8ff",color:"#a855f7",border:"1.5px dashed #a855f7",width:"100%",fontSize:13,marginBottom:14}}>+ Yeni Grup Ekle</button>)}
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            {Object.entries(TYPE_LABELS).map(([k,v])=>(
              <button key={k} onClick={()=>setActiveType(k)} style={{...s.typeChip,flex:1,padding:"8px 4px",background:activeType===k?v.bg:"#f9fafb",borderColor:activeType===k?v.border:"#e5e7eb",color:activeType===k?v.color:"#6b7280",fontWeight:activeType===k?700:400,fontSize:12}}>
                {k===TYPE_ROUTINE?"🔁":k===TYPE_ONETIME?"⚡":"⏳"} {v.label}
              </button>
            ))}
          </div>
          <div style={s.addRow}>
            <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTask()} placeholder={`${TYPE_LABELS[activeType].label} görev ekle...`} style={{...s.input,borderColor:TYPE_LABELS[activeType].border}}/>
            <button onClick={addTask} style={{...s.btn,background:TYPE_LABELS[activeType].color}}>+ Ekle</button>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6,alignItems:"center"}}>
            <span style={{fontSize:12,color:"#a07050"}}>Grup:</span>
            <select value={newGroup||""} onChange={e=>setNewGroup(e.target.value||null)} style={s.select}>
              <option value="">— Grupsuz —</option>
              {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {activeType===TYPE_TIMED&&(<><span style={{fontSize:12,color:"#a07050"}}>Son tarih:</span><input type="date" value={newDeadline} onChange={e=>setNewDeadline(e.target.value)} style={s.dateInput}/>{newDeadline&&<button onClick={()=>setNewDeadline("")} style={s.clearDate}>✕</button>}</>)}
          </div>
          <div style={s.hint}>{activeType===TYPE_ROUTINE?"💡 Her gün tekrar eder":activeType===TYPE_ONETIME?"💡 Yalnızca bugün görünür":"💡 Deadline'a kadar her gün görünür"}</div>
          <div style={s.divider}/>
          <div>
            <div style={s.noteHeader}><span style={s.noteTitle}>📝 Ortak Günlük Not</span>{saving&&<span style={s.savingBadge}>kaydediliyor…</span>}</div>
            <textarea value={note} onChange={e=>{setNote(e.target.value);saveNote(e.target.value);}} placeholder="Bugüne özel ortak notunuzu buraya yazın..." style={s.noteArea}/>
          </div>
        </>)}

        {tab==="stock"&&<StockTab roomCode={roomCode} products={products} packageTypes={packageTypes} stock={stock} stockAlerts={stockAlerts} productAlertEnabled={productAlertEnabled} rules={rules} warnings={warnings} ruleWarnings={ruleWarnings} orders={orders} onOrder={handleOrder}/>}
        {tab==="calendar"&&<CalendarTab tasks={tasks} issues={issues} checked={checked} warnings={warnings} ruleWarnings={ruleWarnings}/>}
      </div>
    </div>
  );
}

const s = {
  root:{minHeight:"100vh",background:"linear-gradient(135deg,#fdf6ec 0%,#fce7cb 100%)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"32px 16px",fontFamily:"'Georgia','Times New Roman',serif"},
  card:{background:"#fffdf8",borderRadius:16,boxShadow:"0 4px 32px rgba(180,120,60,0.12)",width:"100%",maxWidth:640,padding:"24px 22px",border:"1px solid #f0e4cc"},
  center:{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"},
  spinner:{width:20,height:20,borderRadius:"50%",border:"3px solid #f0e4cc",borderTopColor:"#f59e0b"},
  title:{fontSize:22,fontWeight:700,color:"#2d1f0e"},
  dateLabel:{fontSize:11,color:"#b07040",textTransform:"uppercase",letterSpacing:"1.2px",fontFamily:"monospace"},
  mainTab:{flex:1,padding:"9px 6px",borderRadius:10,border:"1.5px solid",fontSize:13,cursor:"pointer",fontWeight:600,fontFamily:"inherit"},
  roomPill:{fontSize:11,background:"#fff7ed",border:"1px solid #fed7aa",color:"#ea580c",borderRadius:20,padding:"3px 9px",fontFamily:"monospace",cursor:"pointer",letterSpacing:1,fontWeight:700,userSelect:"none"},
  issuePill:{fontSize:11,background:"#fef2f2",border:"1px solid #fca5a5",color:"#ef4444",borderRadius:20,padding:"3px 9px",fontFamily:"monospace",fontWeight:700},
  warnPill:{fontSize:11,background:"#fffbeb",border:"1px solid #fcd34d",color:"#92400e",borderRadius:20,padding:"3px 9px",fontFamily:"monospace",fontWeight:700},
  orderPill:{fontSize:11,background:"#eff6ff",border:"1px solid #93c5fd",color:"#1d4ed8",borderRadius:20,padding:"3px 9px",fontFamily:"monospace",fontWeight:700},
  nameTag:{fontSize:11,color:"#a07050",fontFamily:"monospace"},
  leaveBtn:{background:"none",border:"1px solid #f0e4cc",borderRadius:6,cursor:"pointer",fontSize:11,color:"#c0a080",padding:"2px 7px"},
  progressWrap:{display:"flex",alignItems:"center",gap:10},
  progressTrack:{flex:1,height:6,background:"#f0e4cc",borderRadius:99,overflow:"hidden"},
  progressFill:{height:"100%",background:"linear-gradient(90deg,#f59e0b,#22c55e)",borderRadius:99,transition:"width 0.4s ease"},
  progressText:{fontSize:12,color:"#a07050",fontFamily:"monospace"},
  taskRow:{display:"flex",alignItems:"flex-start",gap:9,padding:"9px 11px",borderRadius:10,border:"1px solid #f0e4cc",marginBottom:5},
  orderBtn:{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"#a07050",padding:"1px 3px",lineHeight:1,display:"block"},
  checkbox:{width:22,height:22,borderRadius:6,border:"2px solid #d1d5db",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,transition:"all 0.15s",marginTop:1},
  taskName:{fontSize:14,color:"#2d1f0e"},
  typeChip:{borderRadius:6,border:"1.5px solid",padding:"2px 8px",cursor:"pointer",fontFamily:"inherit",fontSize:11},
  issueTag:{fontSize:11,color:"#ef4444",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"3px 8px",marginTop:4,lineHeight:1.5},
  byLabel:{fontSize:10,color:"#c0a878",fontFamily:"monospace"},
  editInput:{width:"100%",fontSize:14,color:"#2d1f0e",border:"none",borderBottom:"2px solid #f59e0b",outline:"none",background:"transparent",padding:"2px 0",fontFamily:"inherit",boxSizing:"border-box"},
  actions:{display:"flex",gap:3,flexShrink:0},
  iconBtn:{background:"none",border:"none",cursor:"pointer",fontSize:13,padding:"2px 4px",borderRadius:4},
  addRow:{display:"flex",gap:8,marginBottom:8},
  input:{flex:1,padding:"10px 14px",borderRadius:10,border:"1.5px solid #f0e4cc",fontSize:14,outline:"none",fontFamily:"inherit",background:"#fff",color:"#2d1f0e",boxSizing:"border-box",width:"100%"},
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
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16},
  modal:{background:"#fffdf8",borderRadius:16,padding:24,width:"100%",maxWidth:420,boxShadow:"0 8px 32px rgba(0,0,0,0.15)",border:"1px solid #f0e4cc"},
  existingIssue:{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 12px",marginBottom:10},
  productCard:{background:"#fff",border:"1px solid #f0e4cc",borderRadius:12,padding:16,marginBottom:12},
  th:{padding:"8px 10px",textAlign:"left",fontWeight:600,fontSize:12,color:"#a07050",borderBottom:"1px solid #f0e4cc"},
  td:{padding:"8px 10px",verticalAlign:"middle"},
  stockBtn:{background:"#f9f5ef",border:"1px solid #f0e4cc",borderRadius:6,cursor:"pointer",fontSize:16,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,color:"#a07050",flexShrink:0},
  stockInput:{width:46,textAlign:"center",border:"1.5px solid",borderRadius:6,padding:"3px 4px",fontSize:13,fontFamily:"monospace",outline:"none",background:"#fff"},
  alertInput:{width:38,textAlign:"center",border:"1px solid #f0e4cc",borderRadius:6,padding:"2px 4px",fontSize:11,fontFamily:"monospace",outline:"none",background:"#fff",color:"#a07050"},
};
