"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { loginOrRegister, getDashboardData, addCustomer, addEntry, updateEntryStatus, updateSettings, saveNotification } from "./actions";

// Types
type Screen = "splash" | "login" | "dashboard" | "customers" | "ledger" | "settings";
type Customer = { id: string; name: string; phone: string; address?: string | null; notes?: string | null };
type Entry = { id: string; customer_id: string; amount: string; type: "debit" | "credit"; status: "pending" | "paid"; due_date: Date | null; note: string | null; created_at: Date };
type Notification = { id: string; customer_id: string; message: string; created_at: Date };

export default function App() {
  const [token, setToken] = useState<string>("");
  const [view, setView] = useState<Screen>("splash");

  // Data States
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState({ name: "User", bizName: "My Shop", lang: "en", template: "" });
  const [activeCustomer, setActiveCustomer] = useState<Customer | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);

  // Bottom Sheet
  const [sheet, setSheet] = useState<"add_entry" | "add_customer" | "update_status" | "reminder" | "notifications" | "bulk_reminder" | null>(null);
  const [sheetData, setSheetData] = useState<any>(null);

  // Filtering States
  const [search, setSearch] = useState("");
  const [ledgerDateFilter, setLedgerDateFilter] = useState<string>(""); // YYYY-MM format

  // Pull To Refresh States
  const [pullY, setPullY] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = localStorage.getItem("baki_token");
    setTimeout(() => {
      if (t) {
        setToken(t);
        fetchData(t);
        setView("dashboard");
      } else {
        setView("login");
      }
    }, 1500);
  }, []);

  async function fetchData(t: string) {
    const data = await getDashboardData(t);
    if (!data.error) {
      setCustomers(data.customers as Customer[]);
      setEntries(data.entries as Entry[]);
      setNotifications(data.notifications as Notification[]);
      if (data.user) setSettings({ name: data.user.name || "User", bizName: data.user.bizName || "Shop", lang: data.user.lang || "en", template: data.user.template || "" });
    }
  }

  // Pull-To-Refresh Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
    } else {
      startY.current = 0;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY.current > 0 && !isRefreshing) {
      const y = e.touches[0].clientY;
      const diff = y - startY.current;
      if (diff > 0) {
        setPullY(Math.min(diff, 70));
      }
    }
  };

  const handleTouchEnd = async () => {
    if (pullY > 50 && !isRefreshing) {
      setIsRefreshing(true);
      setPullY(60);
      await fetchData(token);
      setPullY(0);
      setIsRefreshing(false);
    } else {
      setPullY(0);
    }
    startY.current = 0;
  };

  // Derived Calculations
  const calculations = useMemo(() => {
    let dueToday = 0;
    let overdue = 0;

    // Customer Balances Map
    const balances: Record<string, number> = {};
    const statuses: Record<string, string> = {};

    customers.forEach(c => balances[c.id] = 0);

    entries.forEach(e => {
      const amt = Number(e.amount) || 0;
      if (e.type === 'debit') {
        balances[e.customer_id] = (balances[e.customer_id] || 0) + amt;
        if (e.status !== 'paid') {
          const d = new Date(e.due_date || new Date());
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          d.setHours(0, 0, 0, 0);
          if (d.getTime() < today.getTime()) overdue += amt;
          if (d.getTime() === today.getTime()) dueToday += amt;
        }
      }
      if (e.type === 'credit') {
        balances[e.customer_id] = (balances[e.customer_id] || 0) - amt;
      }
    });

    let totalPending = 0;
    customers.forEach(c => {
      const b = balances[c.id] || 0;
      if (b > 0) totalPending += b;

      if (b <= 0) statuses[c.id] = 'paid';
      else statuses[c.id] = 'pending';
    });

    if (overdue > totalPending) overdue = totalPending;
    if (dueToday > totalPending) dueToday = totalPending;

    return { totalPending, dueToday, overdue, balances, statuses };
  }, [customers, entries]);

  const t = (key: string) => {
    const en: Record<string, string> = { home: 'Home', customers: 'Customers', settings: 'Settings', pending: 'Total Pending', due: 'Due Today', overdue: 'Overdue', login: 'Secure Account', send: 'Send WhatsApp' };
    const hi: Record<string, string> = { home: 'होम', customers: 'ग्राहक', settings: 'सेटिंग्स', pending: 'कुल बकाया', due: 'आज देय', overdue: 'ओवरड्यू', login: 'सुरक्षित लॉगिन', send: 'व्हाट्सऐप' };
    return settings.lang === 'hi' ? (hi[key] || key) : (en[key] || key);
  };

  const fmt = (n: number) => "₹" + Math.max(0, n).toLocaleString('en-IN');

  const navTo = (v: Screen) => { setView(v); setSheet(null); setSearch(""); setLedgerDateFilter(""); setSelectedCustomers([]); setSelectMode(false); }

  const filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));

  let ledgerEntries = activeCustomer ? entries.filter(e => e.customer_id === activeCustomer.id) : [];
  if (ledgerDateFilter) {
    ledgerEntries = ledgerEntries.filter(e => {
      const d = new Date(e.created_at);
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      return `${d.getFullYear()}-${mm}` === ledgerDateFilter;
    });
  }

  return (
    <div className="max-w-md mx-auto bg-slate-50 min-h-screen text-slate-800 font-sans shadow-2xl relative overflow-hidden flex flex-col selection:bg-indigo-100">

      {/* 1. Splash Screen */}
      {view === 'splash' && (
        <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-br from-indigo-700 to-purple-800">
          <div className="w-20 h-24 border-[3px] border-white/90 rounded-[10px] flex flex-col items-center justify-center relative mb-6 animate-pulse shadow-2xl">
            <div className="w-14 border-b-2 border-white/90 mb-2"></div>
            <div className="w-10 border-b-2 border-white/90 mb-2 ml-[-10px]"></div>
            <div className="w-12 border-b-2 border-white/90 ml-2"></div>
            <div className="absolute -bottom-3 -right-3 w-10 h-10 rounded-full bg-gradient-to-r from-orange-400 to-red-500 border-[3px] border-indigo-700 text-center text-white font-bold text-xl flex items-center justify-center shadow-lg">₹</div>
          </div>
          <h1 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Baki Reminder</h1>
          <p className="text-indigo-200 font-semibold tracking-wide text-sm uppercase">Cloud Edition</p>
        </div>
      )}

      {/* 2. Login Screen */}
      {view === 'login' && <LoginScreen setToken={setToken} setView={setView} onSync={fetchData} />}

      {/* 3. Main Views Wrapper */}
      {(view === 'dashboard' || view === 'customers' || view === 'settings' || view === 'ledger') && (

        <div
          ref={scrollRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex-1 overflow-y-auto pb-24 relative"
        >
          {/* Global Loading Spinner / Pull To Refresh visual */}
          <div
            className="absolute top-0 left-0 right-0 flex justify-center items-center z-0 transition-all duration-300 pointer-events-none"
            style={{ transform: `translateY(${Math.max(pullY - 40, -40)}px)`, opacity: pullY > 10 ? 1 : 0 }}
          >
            <div className="bg-white shadow-xl rounded-full w-10 h-10 flex items-center justify-center border border-slate-100">
              <span className={`text-xl ${isRefreshing ? "animate-spin" : "animate-bounce"}`}>⏳</span>
            </div>
          </div>

          <div className="relative z-10 transition-transform duration-300 min-h-full" style={{ transform: `translateY(${pullY}px)` }}>

            {/* Dashboard */}
            {view === 'dashboard' && (
              <div className="animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-gradient-to-br from-[#5138ed] to-[#3a20d4] text-white pt-10 pb-8 px-6 rounded-b-[2.5rem] shadow-[0_15px_40px_rgba(81,56,237,0.2)]">
                  <div className="flex justify-between items-center mb-8">
                    <div>
                      <p className="text-sm text-indigo-200 font-medium mb-0.5">Namaste, {settings.name}</p>
                      <h2 className="text-2xl font-extrabold tracking-tight drop-shadow-sm">{settings.bizName}</h2>
                    </div>
                    {/* Modern Notification Bell */}
                    <div onClick={() => setSheet('notifications')} className="relative cursor-pointer ripple-click bg-white/10 hover:bg-white/20 p-3 rounded-2xl backdrop-blur-md transition-all shadow-sm border border-white/10">
                      <span className="text-xl">🔔</span>
                      {notifications.length > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-red-500 rounded-full border-2 border-[#5138ed] text-[10px] font-black">{notifications.length}</span>}
                      {notifications.length === 0 && calculations.dueToday > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#5138ed] animate-pulse"></span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-indigo-500/40 to-indigo-600/40 backdrop-blur-md rounded-3xl p-5 border border-white/20 shadow-inner flex flex-col justify-center">
                      <p className="text-indigo-200 text-xs font-bold uppercase tracking-widest mb-1.5">{t('pending')}</p>
                      <h3 className="text-3xl font-black drop-shadow-sm">{fmt(calculations.totalPending)}</h3>
                    </div>

                    <div className="grid grid-rows-2 gap-3">
                      <div className="bg-gradient-to-r from-orange-400 to-orange-500 rounded-[1.2rem] p-3 px-4 flex justify-between items-center shadow-md">
                        <div>
                          <p className="text-[10px] text-orange-100 font-bold uppercase tracking-wider">{t('due')}</p>
                          <p className="font-extrabold text-lg">{fmt(calculations.dueToday)}</p>
                        </div>
                        <div className="bg-white/20 w-8 h-8 rounded-full flex justify-center items-center text-sm shadow-inner">⏰</div>
                      </div>
                      <div className="bg-gradient-to-r from-red-500 to-red-600 rounded-[1.2rem] p-3 px-4 flex justify-between items-center shadow-md">
                        <div>
                          <p className="text-[10px] text-red-100 font-bold uppercase tracking-wider">{t('overdue')}</p>
                          <p className="font-extrabold text-lg">{fmt(calculations.overdue)}</p>
                        </div>
                        <div className="bg-white/20 w-8 h-8 rounded-full flex justify-center items-center text-sm shadow-inner">⚠️</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6">
                  <div className="flex justify-between items-center mb-5">
                    <h3 className="font-extrabold text-lg text-slate-800 tracking-tight">Recent Activity</h3>
                    <button onClick={() => navTo('customers')} className="text-sm font-bold text-indigo-600 hover:text-indigo-800 transition-colors uppercase tracking-wider">View All</button>
                  </div>

                  <div className="bg-white rounded-3xl p-2.5 shadow-sm border border-slate-100 flex flex-col gap-1.5">
                    {entries.slice(0, 5).map(e => {
                      const c = customers.find(x => x.id === e.customer_id);
                      return (
                        <div key={e.id} className="ripple-click p-3.5 flex justify-between items-center hover:bg-slate-50 rounded-2xl cursor-pointer transition-colors" onClick={() => { setActiveCustomer(c || null); navTo('ledger') }}>
                          <div className="flex items-center gap-3.5">
                            <div className={`w-11 h-11 rounded-full flex items-center justify-center font-black text-lg shadow-sm border ${e.type === 'credit' ? 'bg-[#e8f7ec] text-[#12a150] border-green-100' : 'bg-[#fce8e8] text-[#d92c2c] border-red-100'}`}>
                              {e.type === 'credit' ? '↓' : '↑'}
                            </div>
                            <div>
                              <p className="font-bold text-slate-800 leading-tight mb-0.5">{c?.name || "Unknown"}</p>
                              <p className="text-[11px] font-medium text-slate-400 tracking-wide uppercase">{new Date(e.created_at).toLocaleDateString()} · {e.note || e.type}</p>
                            </div>
                          </div>
                          <div className={`font-black tracking-tight ${e.type === 'credit' ? 'text-[#12a150]' : 'text-[#d92c2c]'}`}>
                            {e.type === 'credit' ? '+' : '-'}₹{Number(e.amount).toLocaleString('en-IN')}
                          </div>
                        </div>
                      )
                    })}
                    {entries.length === 0 && <p className="text-center p-8 text-slate-400 font-medium text-sm border-2 border-dashed border-slate-100 rounded-3xl m-2">No transactions yet.</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Customers List */}
            {view === 'customers' && (
              <div className="p-6 pt-8 animate-in fade-in slide-in-from-right-4">
                <div className="flex justify-between items-center mb-5">
                  <h2 className="text-3xl font-extrabold tracking-tight">{t('customers')} <span className="text-indigo-500">({filteredCustomers.length})</span></h2>
                  <button onClick={() => { setSelectMode(!selectMode); setSelectedCustomers([]); }} className={`ripple-click text-xs font-bold px-3 py-1.5 rounded-lg border ${selectMode ? 'bg-slate-800 text-white border-slate-900' : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>
                    {selectMode ? 'Cancel Selection' : 'Bulk Alert'}
                  </button>
                </div>

                <div className="bg-white flex items-center p-4 rounded-2xl shadow-sm border border-slate-200 mb-6 focus-within:ring-4 ring-indigo-50 transition-all">
                  <span className="text-slate-400 mr-3 text-lg">🔍</span>
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search a customer..." className="w-full bg-transparent outline-none font-bold text-slate-700 placeholder:text-slate-400" />
                  {search && <span onClick={() => setSearch("")} className="text-slate-400 text-lg cursor-pointer">✖</span>}
                </div>

                <div className="space-y-3.5">
                  {filteredCustomers.map(c => {
                    const bal = calculations.balances[c.id];
                    const isSelected = selectedCustomers.includes(c.id);
                    return (
                      <div key={c.id} onClick={() => {
                        if (selectMode) {
                          if (isSelected) setSelectedCustomers(selectedCustomers.filter(id => id !== c.id));
                          else setSelectedCustomers([...selectedCustomers, c.id]);
                        } else {
                          setActiveCustomer(c); navTo('ledger');
                        }
                      }} className={`ripple-click bg-white p-4.5 rounded-[1.2rem] shadow-sm border flex justify-between items-center cursor-pointer hover:shadow-md transition-all ${isSelected ? 'border-indigo-400 bg-indigo-50/50 ring-2 ring-indigo-100' : 'border-slate-100'}`}>
                        <div className="flex items-center gap-4">
                          {selectMode ? (
                            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center mr-1 ${isSelected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'}`}>
                              {isSelected && '✓'}
                            </div>
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-slate-100 to-slate-200 flex items-center justify-center font-black text-slate-500 shadow-inner border border-white text-lg uppercase">{c.name.charAt(0)}</div>
                          )}
                          <div>
                            <p className="font-bold text-slate-800 tracking-tight leading-snug">{c.name}</p>
                            <p className="text-xs font-semibold text-slate-400 tracking-wide mt-0.5">+91 {c.phone}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-black tracking-tight ${bal > 0 ? 'text-[#d92c2c]' : 'text-[#12a150]'}`}>{bal > 0 ? fmt(bal) : '✓ Clear'}</p>
                          <p className={`text-[9px] font-bold uppercase tracking-widest mt-1 px-1.5 py-0.5 rounded-md inline-block ${bal > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{bal > 0 ? 'Pending' : 'Paid'}</p>
                        </div>
                      </div>
                    )
                  })}
                  {filteredCustomers.length === 0 && <p className="text-center p-8 text-slate-400 font-medium text-sm border-2 border-dashed border-slate-200 rounded-3xl m-2">No customers found.</p>}
                </div>
              </div>
            )}

            {/* Settings */}
            {view === 'settings' && (
              <div className="p-6 pt-8 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-3xl font-extrabold tracking-tight mb-6">{t('settings')}</h2>
                <div className="space-y-5">

                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                    <label className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-3 block">Business Setup</label>
                    <input value={settings.bizName} readOnly className="w-full bg-slate-50 opacity-80 p-4 rounded-2xl border border-slate-200 font-bold mb-4 outline-none text-slate-700" />

                    <div className="flex items-center justify-between p-4 border border-slate-200 rounded-2xl bg-slate-50/80">
                      <div>
                        <p className="font-bold tracking-tight text-slate-800">App Language</p>
                        <p className="text-xs font-semibold text-slate-400 mt-0.5">English / हिंदी</p>
                      </div>
                      <button onClick={async () => {
                        const nL = settings.lang === 'hi' ? 'en' : 'hi';
                        setSettings({ ...settings, lang: nL });
                        await updateSettings(token, nL, settings.bizName, settings.template);
                      }} className="ripple-click hover:bg-indigo-100 bg-indigo-50 border border-indigo-100 text-indigo-700 font-extrabold text-sm px-4 py-2 rounded-xl transition-colors">Switch</button>
                    </div>
                  </div>

                  <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="ripple-click w-full bg-[#fff4f4] text-red-600 font-extrabold text-[15px] p-4 rounded-xl border border-[#ffcdcd] hover:bg-red-50 tracking-wide flex justify-center items-center gap-2">
                    <span className="text-lg">🚪</span> Disconnect Secure Account
                  </button>
                </div>
                <p className="text-center text-[10px] font-black text-slate-300 mt-8 uppercase tracking-[0.2em]">Next.js Market Version 1.0 🚀</p>
              </div>
            )}

            {/* Individual Ledger */}
            {view === 'ledger' && activeCustomer && (
              <div className="animate-in fade-in slide-in-from-right-4 min-h-screen bg-slate-50">
                <div className="bg-white p-4 py-3 border-b flex items-center shadow-sm sticky top-0 z-10 backdrop-blur-xl bg-white/90">
                  <button onClick={() => navTo('customers')} className="mr-3 ripple-click bg-slate-100 hover:bg-slate-200 w-10 h-10 rounded-full flex justify-center items-center text-slate-600 font-bold transition-colors">←</button>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-extrabold text-lg leading-tight text-slate-800 truncate">{activeCustomer.name}</h3>
                    <p className="text-xs font-semibold tracking-wide text-slate-400">+91 {activeCustomer.phone}</p>
                  </div>
                  <button onClick={() => window.open(`https://wa.me/91${activeCustomer.phone}`)} className="ripple-click bg-[#e8fceb] text-[#25d366] border border-[#aef4c1] w-10 h-10 rounded-full flex items-center justify-center text-lg mr-2 hover:bg-[#d0f9d9] transition-colors">💬</button>
                  <button onClick={() => window.open(`tel:${activeCustomer.phone}`)} className="ripple-click bg-indigo-50 border border-indigo-100 text-indigo-600 w-10 h-10 rounded-full flex items-center justify-center text-sm shadow-inner transition-colors hover:bg-indigo-100">📞</button>
                </div>

                <div className="p-5">
                  <div className="bg-gradient-to-br from-[#f8f9fc] to-[#f1f4fb] border border-indigo-100 rounded-[2rem] p-6 flex flex-col items-center justify-center mb-6 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 font-bold text-6xl">₹</div>
                    <p className="text-indigo-500 text-[10px] font-black uppercase tracking-[0.15em] mb-1.5 z-10">Net Balance</p>
                    <h2 className={`text-[2.75rem] font-black z-10 drop-shadow-sm tracking-tight ${calculations.balances[activeCustomer.id] > 0 ? 'text-[#d92c2c]' : 'text-[#12a150]'}`}>{fmt(calculations.balances[activeCustomer.id])}</h2>
                  </div>

                  <div className="flex justify-between items-center mb-4 px-1">
                    <h3 className="font-extrabold tracking-tight text-slate-800 text-lg">Transactions</h3>

                    <div className="flex items-center gap-2">
                      <input
                        type="month"
                        value={ledgerDateFilter}
                        onChange={(e) => setLedgerDateFilter(e.target.value)}
                        className="bg-white border border-slate-200 text-slate-600 text-xs font-bold px-2 py-1.5 rounded-lg outline-none"
                      />
                      <button onClick={() => setSheet('reminder')} className="ripple-click text-xs bg-gradient-to-r from-green-500 to-emerald-600 text-white font-black px-4 py-2 rounded-full shadow-lg shadow-green-500/30 flex items-center gap-1.5">
                        <span className="text-lg leading-none mb-0.5">💬</span> Alert
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-[2rem] p-2 shadow-sm border border-slate-100 flex flex-col gap-1">
                    {ledgerEntries.map(e => (
                      <div key={e.id} onClick={() => { if (e.status === 'pending' && e.type === 'debit') { setSheet('update_status'); setSheetData(e); } }} className="ripple-click p-4 rounded-2xl flex items-center gap-3.5 hover:bg-slate-50 cursor-pointer transition-colors">
                        <div className={`w-11 h-11 rounded-full flex items-center justify-center font-black text-lg flex-shrink-0 border ${e.type === 'credit' ? 'bg-[#e8f7ec] text-[#12a150] border-green-100' : 'bg-[#fce8e8] text-[#d92c2c] border-red-100'}`}>
                          {e.type === 'credit' ? '↓' : '↑'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-800 truncate leading-snug">{e.note || (e.type === 'credit' ? 'Payment In' : 'Balance Given')}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-[10px] font-bold tracking-wider uppercase text-slate-400">{new Date(e.created_at).toLocaleDateString()}</p>
                            <span className={`text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center ${e.status === 'paid' ? 'bg-[#e8f7ec] text-[#12a150]' : 'bg-orange-50 text-orange-600'}`}>{e.status}</span>
                          </div>
                        </div>
                        <div className={`font-black text-lg tracking-tight ${e.type === 'credit' ? 'text-[#12a150]' : 'text-[#d92c2c]'}`}>
                          {e.type === 'credit' ? '+' : '-'}₹{Number(e.amount)}
                        </div>
                      </div>
                    ))}
                    {ledgerEntries.length === 0 && <div className="text-center py-12 px-4 rounded-3xl border-2 border-dashed border-slate-100 m-2"><p className="text-3xl mb-2 opacity-50">📑</p><p className="font-bold text-slate-400">{ledgerDateFilter ? "No entries in this month." : "No entries yet."}</p></div>}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Floating Action Button & Bottom Navigation Wrapper */}
      {view !== 'splash' && view !== 'login' && view !== 'ledger' && (
        <div className="fixed bottom-0 max-w-md w-full z-20 pointer-events-none">
          {/* Enhanced FAB */}
          {!selectMode && (
            <div className="absolute right-6 -top-16 pointer-events-auto">
              <button onClick={() => view === 'customers' ? setSheet('add_customer') : setSheet('add_entry')} className="ripple-click bg-gradient-to-tr from-indigo-700 to-indigo-500 text-white w-16 h-16 rounded-full flex items-center justify-center text-[2rem] pb-1 font-light shadow-[0_10px_25px_rgba(79,70,229,0.5)] border-2 border-indigo-400/50 transition-all">+</button>
            </div>
          )}

          {/* Glassmorphic Bottom Nav or Multi-Select Action */}
          {selectMode && selectedCustomers.length > 0 ? (
            <div className="bg-white/95 backdrop-blur-xl border-t border-slate-100 shadow-[0_-15px_40px_rgba(0,0,0,0.1)] p-4 px-5 pb-safe pointer-events-auto flex animate-in slide-in-from-bottom-4">
              <button onClick={() => setSheet('bulk_reminder')} className="ripple-click flex-1 bg-indigo-600 text-white font-extrabold py-4 rounded-[1.2rem] shadow-[0_10px_20px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-2 text-lg">
                <span className="text-xl leading-none">💬</span> Alert {selectedCustomers.length} Customers
              </button>
            </div>
          ) : (
            <div className="bg-white/90 backdrop-blur-xl border-t border-slate-100 shadow-[0_-15px_40px_rgba(0,0,0,0.06)] pb-safe pointer-events-auto flex px-2 pt-1">
              {[{ id: 'dashboard', ic: '🏠', t: t('home') }, { id: 'customers', ic: '👥', t: t('customers') }, { id: 'settings', ic: '⚙️', t: t('settings') }].map(n => (
                <button key={n.id} onClick={() => navTo(n.id as Screen)} className="ripple-click flex-1 py-3.5 flex flex-col items-center gap-1.5 transition-all">
                  <span className={`text-[22px] transition-transform ${view === n.id ? 'opacity-100 scale-110 drop-shadow-md' : 'opacity-40 grayscale scale-100 hover:opacity-70'}`}>{n.ic}</span>
                  <span className={`text-[10px] font-extrabold tracking-widest ${view === n.id ? 'text-indigo-600' : 'text-slate-400'}`}>{n.t}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ledger Sticky Add Button */}
      {view === 'ledger' && (
        <div className="fixed bottom-0 max-w-md w-full z-20 bg-white/95 backdrop-blur-md border-t border-slate-100 p-4 px-5 flex shadow-[0_-15px_30px_rgba(0,0,0,0.04)] pb-safe">
          <button onClick={() => setSheet('add_entry')} className="ripple-click flex-1 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-extrabold py-4 rounded-[1.2rem] shadow-[0_10px_20px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-2 text-lg tracking-wide border border-indigo-400/30">
            <span className="text-xl leading-none mb-1">+</span> Add Baki / Payment
          </button>
        </div>
      )}

      {/* 4. Bottom Sheets Overlay */}
      {sheet && (
        <>
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] z-40 transition-opacity animate-in fade-in duration-200" onClick={() => setSheet(null)}></div>
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto bg-white rounded-t-[2.5rem] z-50 p-7 pt-9 pb-safe pb-10 shadow-[0_-20px_60px_rgba(0,0,0,0.15)] animate-in slide-in-from-bottom-full duration-300 custom-scrollbar">
            <div className="sticky top-0 left-1/2 -translate-x-1/2 w-14 h-1.5 bg-slate-200 rounded-full mb-6 mt-[-15px]"></div>

            {sheet === 'add_customer' && <AddCustomerForm token={token} onSuccess={() => { fetchData(token); setSheet(null); }} />}
            {sheet === 'add_entry' && <AddEntryForm token={token} customers={customers} predefinedCustId={activeCustomer?.id} onSuccess={() => { fetchData(token); setSheet(null) }} />}
            {sheet === 'reminder' && activeCustomer && <ReminderSheet activeCustomer={activeCustomer} settings={settings} calculations={calculations} fmt={fmt} setSheet={setSheet} token={token} onSuccess={() => fetchData(token)} />}
            {sheet === 'bulk_reminder' && <BulkReminderSheet selectedCustomers={selectedCustomers} customers={customers} settings={settings} calculations={calculations} fmt={fmt} setSheet={setSheet} token={token} onSuccess={() => fetchData(token)} />}
            {sheet === 'update_status' && sheetData && <UpdateStatusForm token={token} entry={sheetData} onSuccess={() => { fetchData(token); setSheet(null); }} />}
            {sheet === 'notifications' && <NotificationsSheet notifications={notifications} customers={customers} setActiveCustomer={setActiveCustomer} setSheet={setSheet} navTo={navTo} />}
          </div>
        </>
      )}
    </div>
  );
}

// ======================== Sub Components ========================

function LoginScreen({ setToken, setView, onSync }: { setToken: any, setView: any, onSync: any }) {
  // Same Logic, enhanced UI
  const [mode, setMode] = useState<"login" | "register">("login");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [biz, setBiz] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAction(e: any) {
    e.preventDefault();
    if (phone.length !== 10 || pin.length !== 4) return alert("Valid Phone and 4-digit PIN required");
    setLoading(true);
    const res = await loginOrRegister(phone, pin, mode === 'register', name, biz);
    if (res.token) {
      localStorage.setItem("baki_token", res.token);
      setToken(res.token);
      await onSync(res.token);
      setView("dashboard");
    } else {
      alert(res.error || "Failed");
    }
    setLoading(false);
  }

  return (
    <div className="p-8 pb-20 flex flex-col justify-center h-full bg-white z-50 animate-in fade-in zoom-in-95 duration-500">
      <div className="w-24 h-24 mx-auto bg-gradient-to-br from-indigo-100 to-indigo-50 rounded-full flex items-center justify-center text-5xl mb-6 shadow-inner border border-indigo-100">📱</div>
      <h1 className="text-[2rem] font-black tracking-tight text-slate-800 text-center mb-1 drop-shadow-sm">Baki Reminder</h1>
      <p className="text-slate-400 text-center mb-10 font-bold tracking-wide uppercase text-xs">{mode === 'login' ? "Log into your account" : "Setup your new shop"}</p>

      <form onSubmit={handleAction} className="flex flex-col gap-4">
        <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1">Phone Number</label>
        <div className="flex bg-[#f8f9fc] border border-slate-200 rounded-2xl p-4 items-center focus-within:border-indigo-500 focus-within:ring-4 ring-indigo-50 transition-all">
          <span className="text-slate-400 mr-3 font-black text-lg">+91</span>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} required className="bg-transparent outline-none w-full font-black text-xl text-slate-800 tracking-wide placeholder:text-slate-300" placeholder="98765 43210" maxLength={10} />
        </div>

        {mode === 'register' && (
          <div className="animate-in fade-in slide-in-from-top-4 space-y-4">
            <div>
              <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1 block mb-1">Your Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required className="w-full bg-[#f8f9fc] border border-slate-200 rounded-2xl p-4 outline-none font-bold text-lg focus:border-indigo-500 focus:ring-4 ring-indigo-50 transition-all placeholder:text-slate-300" placeholder="e.g. Suresh" />
            </div>
            <div>
              <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1 block mb-1">Shop Name</label>
              <input type="text" value={biz} onChange={e => setBiz(e.target.value)} required className="w-full bg-[#f8f9fc] border border-slate-200 rounded-2xl p-4 outline-none font-bold text-lg focus:border-indigo-500 focus:ring-4 ring-indigo-50 transition-all placeholder:text-slate-300" placeholder="e.g. Suresh Traders" />
            </div>
          </div>
        )}

        <label className="text-xs font-black uppercase text-slate-400 tracking-widest ml-1 mt-2">Secure PIN</label>
        <div className="flex bg-[#f8f9fc] border border-slate-200 rounded-2xl p-4 focus-within:border-indigo-500 focus-within:ring-4 ring-indigo-50 transition-all">
          <input type="password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} required className="bg-transparent outline-none w-full font-black tracking-[0.7em] text-3xl text-center text-indigo-700 placeholder:text-slate-300" placeholder="****" maxLength={4} />
        </div>

        <button type="submit" disabled={loading} className="ripple-click mt-6 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-extrabold rounded-2xl py-4.5 shadow-[0_10px_25px_rgba(79,70,229,0.3)] transition-all text-lg tracking-wide border border-indigo-400/40">{loading ? "Processing..." : (mode === 'login' ? "Secure Login" : "Register & Activate")}</button>
      </form>

      <p className="text-center mt-8 text-sm font-bold text-slate-400 cursor-pointer hover:text-indigo-600 transition-colors" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? "New Shop? Register Here" : "Already have account? Login"}</p>
    </div>
  )
}

function AddCustomerForm({ token, onSuccess }: any) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const handleImport = async () => {
    if ('contacts' in navigator && 'ContactsManager' in window) {
      try {
        const contacts = await (navigator as any).contacts.select(['name', 'tel'], { multiple: false });
        if (contacts.length > 0) {
          setName(contacts[0].name[0] || '');
          setPhone((contacts[0].tel[0] || '').replace(/\D/g, '').slice(-10));
        }
      } catch (ex) { alert("Import failed."); }
    } else {
      alert("Not supported on this device/browser.");
    }
  };

  return (
    <form action={async () => { await addCustomer(token, name, phone, '', ''); onSuccess(); }}>
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-2xl font-black tracking-tight drop-shadow-sm text-slate-800">Add Customer</h3>
        <button type="button" onClick={handleImport} className="ripple-click text-xs font-bold bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg border border-indigo-100 flex items-center gap-1.5 shadow-sm">
          <span>📱</span> Import Contact
        </button>
      </div>

      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Customer Name</label>
      <input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Deepak Dhakpura" className="w-full bg-[#f8f9fc] p-4.5 rounded-2xl border border-slate-200 font-bold mb-4 focus:border-indigo-500 outline-none text-lg transition-all" />

      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Phone Number</label>
      <div className="flex bg-[#f8f9fc] border border-slate-200 rounded-2xl mb-8 p-4.5 items-center focus-within:border-indigo-500 transition-all">
        <span className="text-slate-400 mr-2 font-black text-lg">+91</span>
        <input value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} type="tel" maxLength={10} required placeholder="10 Digit Number" className="bg-transparent outline-none w-full font-bold text-lg text-slate-800" />
      </div>

      <button type="submit" className="ripple-click w-full bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-black rounded-2xl py-4.5 shadow-[0_10px_20px_rgba(79,70,229,0.25)] text-lg tracking-wide border border-indigo-400/30">Save Customer</button>
    </form>
  )
}

function AddEntryForm({ token, customers, predefinedCustId, onSuccess }: any) {
  const [type, setType] = useState<"debit" | "credit">("debit");
  const [search, setSearch] = useState("");
  const [selectedCust, setSelectedCust] = useState(predefinedCustId || "");
  const [showDropdown, setShowDropdown] = useState(false);

  // Initialize with today's date formatted for the input
  const today = new Date().toISOString().split('T')[0];

  const filtered = customers.filter((c: any) => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));
  const activeName = customers.find((c: any) => c.id === selectedCust)?.name || "";

  return (
    <form action={async (fd) => {
      if (!selectedCust) return alert("Please select a customer first.");
      const dateVal = fd.get('tx_date') as string;
      const customDate = dateVal ? new Date(dateVal) : new Date();

      await addEntry(token, selectedCust, Number(fd.get('a')), type, customDate, fd.get('note') as string, customDate);
      onSuccess();
    }}>
      <h3 className="text-[1.35rem] font-black mb-6 tracking-tight text-slate-800">Add Baki / Payment</h3>

      {!predefinedCustId && (
        <div className="mb-5 relative">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Select Customer</label>
          <input
            value={showDropdown ? search : activeName || search}
            onFocus={() => { setShowDropdown(true); setSearch(""); }}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={selectedCust ? activeName : "Type to search..."}
            className="w-full bg-[#f8f9fc] p-4.5 rounded-2xl border border-slate-200 font-bold focus:border-indigo-500 outline-none transition-all placeholder:text-slate-400"
          />
          {showDropdown && (
            <div className="absolute top-[100%] left-0 right-0 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-xl z-50 mt-1">
              {filtered.map((c: any) => (
                <div key={c.id} onClick={() => { setSelectedCust(c.id); setShowDropdown(false); setSearch(""); }} className="p-3.5 border-b border-slate-100 font-bold hover:bg-slate-50 cursor-pointer text-slate-800">
                  {c.name} <span className="text-slate-400 text-sm block">({c.phone})</span>
                </div>
              ))}
              {filtered.length === 0 && <div className="p-3 text-slate-400 text-sm text-center">No customer found</div>}
            </div>
          )}
        </div>
      )}

      <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-5 shadow-inner">
        <div onClick={() => setType('debit')} className={`flex-1 text-center py-3 rounded-xl font-bold cursor-pointer transition-all ${type === 'debit' ? 'bg-red-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'}`}>Given (Baki)</div>
        <div onClick={() => setType('credit')} className={`flex-1 text-center py-3 rounded-xl font-bold cursor-pointer transition-all ${type === 'credit' ? 'bg-[#12a150] text-white shadow-md' : 'text-slate-500 hover:text-slate-700'}`}>Received (Jama)</div>
      </div>

      <div className="flex bg-[#f8f9fc] border border-slate-200 rounded-2xl mb-5 p-4 items-center focus-within:border-indigo-500 focus-within:ring-4 ring-indigo-50 transition-all">
        <span className={`mr-2 font-black text-2xl ${type === 'debit' ? 'text-red-400' : 'text-green-500'}`}>₹</span>
        <input name="a" type="number" step="0.01" required placeholder="0.00" className={`bg-transparent outline-none w-full font-black text-3xl placeholder:text-slate-300 ${type === 'debit' ? 'text-red-500' : 'text-green-600'}`} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Date</label>
          <input type="date" name="tx_date" defaultValue={today} required className="w-full bg-[#f8f9fc] p-4 rounded-xl border border-slate-200 font-bold outline-none focus:border-indigo-500 transition-colors" />
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1 block">Item / Note</label>
          <input name="note" placeholder="Optional" className="w-full bg-[#f8f9fc] p-4 rounded-xl border border-slate-200 font-bold outline-none focus:border-indigo-500 transition-colors" />
        </div>
      </div>

      <button type="submit" className={`ripple-click w-full text-white font-black rounded-2xl py-4.5 text-lg tracking-wide shadow-lg border-b-4 active:border-b-0 active:translate-y-1 transition-all ${type === 'debit' ? 'bg-red-500 border-red-600 hover:bg-red-400 shadow-red-500/30' : 'bg-[#12a150] border-[#0e8040] hover:bg-[#15bd5e] shadow-green-500/30'}`}>Save {type === 'debit' ? 'Baki Entry' : 'Payment Entry'}</button>
    </form>
  )
}

function ReminderSheet({ settings, activeCustomer, calculations, fmt, setSheet, token, onSuccess }: any) {
  const initialText = settings.template.replace('{name}', activeCustomer.name).replace('{amount}', fmt(calculations.balances[activeCustomer.id])).replace('{biz}', settings.bizName).replace('{date}', 'Today');
  const [msg, setMsg] = useState(initialText);

  return (
    <div>
      <h3 className="text-2xl font-black mb-5 tracking-tight text-slate-800">Send Payment Alert</h3>
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Edit Message</label>
      <textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        className="w-full bg-[#f6fbd4]/30 p-4.5 rounded-2xl mb-8 border border-green-200 text-[15px] leading-relaxed text-slate-700 font-semibold outline-none focus:border-green-500 focus:ring-4 ring-green-50 transition-all resize-none h-36 placeholder:text-slate-300"
      />

      <button onClick={async () => {
        window.open(`https://wa.me/91${activeCustomer.phone}?text=${encodeURIComponent(msg)}`);
        await saveNotification(token, activeCustomer.id, msg);
        onSuccess();
        setSheet(null);
      }} className="ripple-click w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-extrabold text-lg py-4.5 rounded-2xl shadow-[0_10px_25px_rgba(37,211,102,0.3)] border border-[#1ead51] flex justify-center items-center gap-2">
        <span className="text-[22px] leading-none mb-0.5">💬</span> Send via WhatsApp
      </button>
    </div>
  )
}

function UpdateStatusForm({ token, entry, onSuccess }: any) {
  const [option, setOption] = useState<"full" | "partial">("full");

  return (
    <form action={async (fd) => {
      const amt = option === 'partial' ? Number(fd.get('pa')) : undefined;
      await updateEntryStatus(token, entry.id, 'paid', amt);
      onSuccess();
    }}>
      <h3 className="text-[1.35rem] font-black mb-1 text-slate-800 tracking-tight">Record Payment</h3>
      <p className="text-[13px] font-semibold text-slate-400 mb-6 bg-slate-50 inline-block px-3 py-1 rounded-full">For Baki of ₹{Number(entry.amount)}</p>

      <div className="space-y-3.5 mb-6">
        <div onClick={() => setOption('full')} className={`border-2 p-4.5 rounded-2xl cursor-pointer transition-all ${option === 'full' ? 'border-[#12a150] bg-[#e8f7ec] shadow-md' : 'border-slate-100 hover:border-slate-200'}`}>
          <h4 className={`font-black flex items-center gap-2.5 text-lg ${option === 'full' ? 'text-[#0e8040]' : 'text-slate-600'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${option === 'full' ? 'border-[#12a150] bg-[#12a150] text-white' : 'border-slate-300'}`}>{option === 'full' && '✓'}</div>
            Fully Paid
          </h4>
          <p className="text-[11px] font-semibold ml-8 mt-0.5 text-slate-500 opacity-80">Mark entire ₹{Number(entry.amount)} as received</p>
        </div>

        <div onClick={() => setOption('partial')} className={`border-2 p-4.5 rounded-2xl cursor-pointer transition-all ${option === 'partial' ? 'border-[#f97316] bg-[#fff7ed] shadow-md' : 'border-slate-100 hover:border-slate-200'}`}>
          <h4 className={`font-black flex items-center gap-2.5 text-lg ${option === 'partial' ? 'text-[#c2410c]' : 'text-slate-600'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${option === 'partial' ? 'border-[#f97316] bg-[#f97316] text-white' : 'border-slate-300'}`}>{option === 'partial' && '✓'}</div>
            Partial Payment
          </h4>
          <p className="text-[11px] font-semibold ml-8 mt-0.5 text-slate-500 opacity-80">Got half money, rest still pending</p>
        </div>
      </div>

      {option === 'partial' && (
        <div className="animate-in fade-in slide-in-from-top-2 flex bg-white border-2 border-orange-200 rounded-2xl mb-8 p-4 items-center focus-within:border-orange-500 shadow-inner">
          <span className="text-orange-400 mr-2 font-black text-2xl">₹</span>
          <input name="pa" type="number" required placeholder={`e.g. ${Number(entry.amount) / 2}`} className="bg-transparent outline-none w-full font-black text-2xl text-orange-600 placeholder:text-orange-200" />
        </div>
      )}

      <button type="submit" className="ripple-click w-full bg-slate-800 text-white font-black text-lg tracking-wide rounded-2xl py-4.5 shadow-xl border-b-4 border-black active:border-b-0 active:translate-y-1 transition-all">Update Database</button>
    </form>
  )
}

function NotificationsSheet({ notifications, customers, setActiveCustomer, setSheet, navTo }: any) {
  return (
    <div className="flex flex-col h-full max-h-[70vh]">
      <h3 className="text-2xl font-black mb-1 p-1 tracking-tight drop-shadow-sm text-slate-800 flex items-center gap-2">🔔 Alerts Sent <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full">{notifications.length}</span></h3>
      <p className="text-xs font-bold text-slate-400 mb-5 px-1 uppercase tracking-wider">Recent WhatsApp Reminders Log</p>

      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {notifications.map((n: any) => {
          const c = customers.find((x: any) => x.id === n.customer_id);
          return (
            <div key={n.id} onClick={() => { if (c) { setActiveCustomer(c); navTo('ledger'); } }} className="ripple-click p-4 bg-slate-50 border border-slate-100 rounded-[1.2rem] flex items-start gap-3.5 cursor-pointer hover:bg-slate-100 transition-colors">
              <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-lg flex-shrink-0 shadow-inner">💬</div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 leading-tight mb-0.5">{c?.name || "Unknown"} <span className="text-[10px] font-medium text-slate-400 block sm:inline mt-0.5 sm:mt-0 sm:ml-2">{new Date(n.created_at).toLocaleString()}</span></p>
                <p className="text-xs text-slate-500 line-clamp-2 mt-1.5 font-medium bg-white border border-slate-200 shadow-sm p-2 rounded-lg italic font-serif">"{n.message}"</p>
              </div>
            </div>
          )
        })}
        {notifications.length === 0 && <div className="text-center py-10 px-4 rounded-3xl border-2 border-dashed border-slate-200 mt-4"><p className="text-3xl mb-2 opacity-50">📭</p><p className="font-bold text-slate-400">No alerts sent yet.</p></div>}
      </div>
    </div>
  )
}

function BulkReminderSheet({ selectedCustomers, customers, settings, calculations, fmt, setSheet, token, onSuccess }: any) {
  const [template, setTemplate] = useState(settings.template);
  const [sentLog, setSentLog] = useState<string[]>([]);

  const selectedObj = customers.filter((c: any) => selectedCustomers.includes(c.id));

  return (
    <div className="flex flex-col h-full max-h-[75vh]">
      <h3 className="text-2xl font-black mb-5 tracking-tight text-slate-800">Bulk Payment Alerts</h3>
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Message Template</p>
      <div className="bg-[#f6fbd4]/30 border border-green-200 p-3 rounded-xl mb-6 shadow-inner">
        <textarea value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full bg-transparent text-sm leading-relaxed text-slate-700 font-semibold outline-none resize-none h-20 placeholder:text-green-800/20" />
        <p className="text-[10px] text-green-700 font-bold uppercase tracking-wider">Use {"{name}"}, {"{amount}"}, {"{biz}"}</p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {selectedObj.map((c: any) => {
          const bal = calculations.balances[c.id] || 0;
          const isSent = sentLog.includes(c.id);
          const personalizedMsg = template.replace('{name}', c.name).replace('{amount}', fmt(bal)).replace('{biz}', settings.bizName).replace('{date}', 'Today');

          return (
            <div key={c.id} className={`p-4 rounded-[1.2rem] border flex items-center justify-between transition-colors ${isSent ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-100'}`}>
              <div>
                <p className={`font-bold ${isSent ? 'text-green-800' : 'text-slate-800'}`}>{c.name}</p>
                <p className={`text-xs font-bold ${isSent ? 'text-green-600' : 'text-slate-400'}`}>{fmt(bal)} Pending</p>
              </div>
              <button disabled={isSent} onClick={async () => {
                window.open(`https://wa.me/91${c.phone}?text=${encodeURIComponent(personalizedMsg)}`);
                await saveNotification(token, c.id, personalizedMsg);
                setSentLog(prev => [...prev, c.id]);
                onSuccess();
              }} className={`text-xs font-black px-4 py-2 rounded-xl border ${isSent ? 'bg-green-100 text-green-600 border-green-200 opacity-70' : 'bg-[#25D366] text-white border-[#1ead51] shadow-md hover:bg-[#20bd5a] ripple-click'} transition-all`}>
                {isSent ? 'Sent ✓' : 'Send 💬'}
              </button>
            </div>
          )
        })}
      </div>

      {sentLog.length === selectedObj.length && (
        <button onClick={() => setSheet(null)} className="mt-4 ripple-click w-full bg-slate-800 text-white font-black text-lg py-4 rounded-xl shadow-xl active:translate-y-1">Done</button>
      )}
    </div>
  )
}
