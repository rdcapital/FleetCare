import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Activity, ArrowDownRight, ArrowUpRight, Bell, Bike, BriefcaseBusiness, CalendarDays, CarFront, Check, ChevronDown, CircleDollarSign, ClipboardList, FileDown, Fuel, LayoutDashboard, LogOut, Menu, Plus, Search, Settings, ShieldCheck, Truck, Wrench, X } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './App.css'

const API = '/api'
const AuthContext = createContext(null)
const AppearanceContext = createContext(null)
const appearanceOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]
const currencyOptions = [
  { value: 'GHS', label: 'Ghana cedi (GHS)' },
  { value: 'USD', label: 'US dollar (USD)' },
  { value: 'GBP', label: 'British pound (GBP)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'NGN', label: 'Nigerian naira (NGN)' },
  { value: 'XOF', label: 'West African CFA franc (XOF)' },
  { value: 'ZAR', label: 'South African rand (ZAR)' },
]
const money = (value = 0, currency = 'GHS') => new Intl.NumberFormat('en-GH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
const shortDate = (value) => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not scheduled'
const vehicleName = (vehicle) => vehicle ? `${vehicle.registrationNumber}${vehicle.make ? ` · ${vehicle.make}` : ''}` : 'Vehicle removed'
const currentDate = new Date()
const today = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`

function getStoredAppearance() {
  try {
    const stored = localStorage.getItem('fleetcare-appearance')
    return appearanceOptions.some((option) => option.value === stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function AppearanceProvider({ children }) {
  const [appearance, setAppearance] = useState(getStoredAppearance)
  useLayoutEffect(() => {
    const systemPreference = window.matchMedia('(prefers-color-scheme: dark)')
    function applyAppearance() {
      const theme = appearance === 'system' ? (systemPreference.matches ? 'dark' : 'light') : appearance
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme
    }
    applyAppearance()
    systemPreference.addEventListener('change', applyAppearance)
    return () => systemPreference.removeEventListener('change', applyAppearance)
  }, [appearance])
  function chooseAppearance(value) {
    if (!appearanceOptions.some((option) => option.value === value)) return
    setAppearance(value)
    try {
      localStorage.setItem('fleetcare-appearance', value)
    } catch {
      // The selected mode still applies for this session when storage is unavailable.
    }
  }
  return <AppearanceContext.Provider value={{ appearance, chooseAppearance }}>{children}</AppearanceContext.Provider>
}

function createRecordForm(item) {
  const form = Object.assign({ date: today, serviceDate: today, odometer: '', litres: '', amount: '', fuelStation: '', notes: '', serviceType: 'Routine servicing', description: '', serviceProvider: '', nextServiceDate: '', nextServiceOdometer: '' }, item)
  form.date = item.date?.slice(0, 10) || today
  form.serviceDate = item.serviceDate?.slice(0, 10) || today
  form.nextServiceDate = item.nextServiceDate?.slice(0, 10) || ''
  form.vehicleId = item.vehicleId?._id || item.vehicleId || ''
  return form
}

async function request(path, options = {}) {
  const token = sessionStorage.getItem('fleetcare-token')
  let response
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new Error('FleetCare cannot reach its API. Start the Backend and check its MongoDB settings, then try again.')
  }
  if (response.status === 204) return null
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message || 'The request could not be completed.')
  return result
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(sessionStorage.getItem('fleetcare-token')))
  useEffect(() => {
    if (!sessionStorage.getItem('fleetcare-token')) return
    request('/auth/me').then(setUser).catch(() => sessionStorage.removeItem('fleetcare-token')).finally(() => setLoading(false))
  }, [])
  async function signIn(path, values) {
    const result = await request(`/auth/${path}`, { method: 'POST', body: JSON.stringify(values) })
    sessionStorage.setItem('fleetcare-token', result.token)
    setUser(result.user)
  }
  async function updateUser(values) {
    const updatedUser = await request('/auth/me', { method: 'PATCH', body: JSON.stringify(values) })
    setUser(updatedUser)
    return updatedUser
  }
  function signOut() {
    sessionStorage.removeItem('fleetcare-token')
    setUser(null)
  }
  return <AuthContext.Provider value={{ user, loading, signIn, signOut, updateUser }}>{children}</AuthContext.Provider>
}

function useAuth() { return useContext(AuthContext) }
function useAppearance() { return useContext(AppearanceContext) }
function useCurrency() {
  const { user } = useAuth()
  return user?.currency || 'GHS'
}
function useMoney() {
  const currency = useCurrency()
  return (value = 0) => money(value, currency)
}
function Protected() {
  const { user, loading } = useAuth()
  if (loading) return <div className="screen-loader"><span className="spinner" />Opening your fleet workspace</div>
  return user ? <Outlet /> : <Navigate to="/login" replace />
}

function App() {
  return <AppearanceProvider><BrowserRouter><AuthProvider><Routes>
    <Route path="/login" element={<AuthPage />} />
    <Route element={<Protected />}><Route element={<Workspace />}>
      <Route index element={<Dashboard />} />
      <Route path="vehicles" element={<Vehicles />} />
      <Route path="vehicles/:id" element={<VehicleProfile />} />
      <Route path="fuel" element={<Records kind="fuel" />} />
      <Route path="maintenance" element={<Records kind="maintenance" />} />
      <Route path="reports" element={<Reports />} />
      <Route path="settings" element={<SettingsPage />} />
    </Route></Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AuthProvider></BrowserRouter></AppearanceProvider>
}

function AuthPage() {
  const { signIn, user } = useAuth()
  const navigate = useNavigate()
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [values, setValues] = useState({ businessName: '', ownerName: '', email: '', password: '' })
  useEffect(() => { if (user) navigate('/') }, [user, navigate])
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await signIn(register ? 'register' : 'login', values); navigate('/') }
    catch (issue) { setError(issue.message) }
    finally { setBusy(false) }
  }
  return <main className="auth-screen">
    <aside className="auth-aside">
      <div className="brand"><span className="brand-mark"><Truck size={20} /></span><span>FleetCare</span></div>
      <div className="auth-message"><div className="eyebrow">FLEET OPERATIONS, MADE CLEAR</div><h1>Keep your fleet running.<br /><em>Keep deliveries moving.</em></h1><p>One calm place to track vehicles, fuel, and the work that keeps every route on schedule.</p>
        <div className="route-art" aria-hidden="true"><div className="route-line" /><div className="route-stop stop-one" /><div className="route-stop stop-two" /><div className="route-stop stop-three" /><div className="route-van"><Truck size={24} /></div><div className="route-label label-one">DEPOT</div><div className="route-label label-two">ON THE ROAD</div></div>
      </div>
      <div className="aside-foot"><ShieldCheck size={16} /> Private records for your business only</div>
    </aside>
    <section className="auth-panel"><div className="auth-form-wrap"><div className="mobile-brand brand"><span className="brand-mark"><Truck size={20} /></span><span>FleetCare</span></div><div className="eyebrow">{register ? 'GET YOUR BUSINESS ON THE ROAD' : 'WELCOME BACK'}</div><h2>{register ? 'Start with your business' : 'Sign in to FleetCare'}</h2><p className="auth-subtitle">{register ? 'Create your private operations workspace.' : 'Your vehicles and records are right where you left them.'}</p>
      <form className="form-stack" onSubmit={submit}>
        {register && <><Field label="Business name" value={values.businessName} onChange={(value) => setValues({ ...values, businessName: value })} required placeholder="e.g. Northline Couriers" /><Field label="Your name" value={values.ownerName} onChange={(value) => setValues({ ...values, ownerName: value })} required placeholder="Owner or manager" /></>}
        <Field label="Email address" type="email" value={values.email} onChange={(value) => setValues({ ...values, email: value })} required placeholder="name@business.com" />
        <Field label="Password" type="password" value={values.password} onChange={(value) => setValues({ ...values, password: value })} required minLength={register ? 8 : undefined} placeholder={register ? 'At least 8 characters' : 'Your password'} />
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button button-primary full-button" disabled={busy}>{busy ? 'Please wait...' : register ? 'Create business account' : 'Sign in'}<ArrowUpRight size={17} /></button>
      </form>
      <div className="auth-switch">{register ? 'Already have a workspace?' : 'New to FleetCare?'} <button onClick={() => { setRegister(!register); setError('') }}>{register ? 'Sign in' : 'Create an account'}</button></div>
    </div><div className="auth-panel-foot">FleetCare <span>·</span> Keep your fleet running.</div></section>
  </main>
}

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/vehicles', label: 'Vehicles', icon: Truck },
  { to: '/fuel', label: 'Fuel records', icon: Fuel },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/reports', label: 'Reports', icon: Activity },
]

function Workspace() {
  const { user, signOut } = useAuth()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const title = navigation.find((item) => item.to === pathname)?.label || (pathname.includes('/vehicles/') ? 'Vehicle profile' : 'Settings')
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <NavLink to="/" className="brand" onClick={() => setMobileOpen(false)}><span className="brand-mark"><Truck size={20} /></span><span>FleetCare</span></NavLink>
      <div className="business-switch"><span className="business-avatar">{user.businessName.slice(0, 1).toUpperCase()}</span><span className="business-info"><strong>{user.businessName}</strong><small>Business workspace</small></span></div>
      <div className="nav-caption">WORKSPACE</div><nav className="side-nav">{navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-callout"><span className="callout-icon"><CalendarDays size={17} /></span><div><strong>Stay road-ready</strong><small>Keep service schedules up to date.</small></div></div><NavLink to="/settings" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Settings size={18} /><span>Settings</span></NavLink>
        <div className="profile-menu"><button className="profile-button" onClick={() => setMenuOpen(!menuOpen)}><span className="user-avatar">{user.ownerName.slice(0, 1).toUpperCase()}</span><span className="business-info"><strong>{user.ownerName}</strong><small>{user.email}</small></span><ChevronDown size={15} /></button>{menuOpen && <button className="signout-menu" onClick={signOut}><LogOut size={15} /> Sign out</button>}</div>
      </div>
    </aside>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <main className="main-area"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs">FleetCare <span>/</span> <strong>{title}</strong></div><div className="topbar-right"><span className="today-label">Business workspace</span><div className="topbar-divider" /><span className="online-state"><i /> All systems ready</span></div></header><div className="page-content"><Outlet /></div></main>
  </div>
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>
}

function ErrorNotice({ error }) { return error ? <div className="notice-error" role="alert">{error}</div> : null }
function EmptyState({ icon: Icon = ClipboardList, title, detail, action }) { return <div className="empty-state"><span className="empty-icon"><Icon size={21} /></span><strong>{title}</strong><p>{detail}</p>{action}</div> }
function LoadingLine() { return <div className="loading-line"><span className="spinner" />Loading your records...</div> }
function StatCard({ icon: Icon, label, value, note, tone = 'green' }) {
  return <article className="stat-card"><div className="stat-card-top"><span className={`stat-icon ${tone}`}><Icon size={18} /></span><span className="stat-note">{note}</span></div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></article>
}

function Dashboard() {
  const formatMoney = useMoney()
  const currency = useCurrency()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { request('/dashboard').then(setData).catch((issue) => setError(issue.message)) }, [])
  const stats = data?.stats
  return <>
    <PageHeading eyebrow="FLEET OVERVIEW" title="Good to see you." description="A clear view of the vehicles and costs moving your business forward." action={<NavLink className="button button-primary" to="/vehicles"><Plus size={17} /> Add a vehicle</NavLink>} />
    <ErrorNotice error={error} />{!data && !error ? <LoadingLine /> : null}
    {stats && <>
      <div className="stat-grid">
        <StatCard icon={Truck} label="Registered vehicles" value={stats.totalVehicles} note="In your fleet" />
        <StatCard icon={Check} label="Active vehicles" value={stats.activeVehicles} note="Ready for routes" tone="blue" />
        <StatCard icon={Wrench} label="In maintenance" value={stats.maintenanceVehicles} note="Current status" tone="amber" />
        <StatCard icon={Fuel} label="Total fuel spend" value={formatMoney(stats.fuelTotal)} note={`${formatMoney(stats.fuelThisMonth)} this month`} tone="blue" />
        <StatCard icon={Wrench} label="Total maintenance" value={formatMoney(stats.maintenanceTotal)} note={`${formatMoney(stats.maintenanceThisMonth)} this month`} tone="coral" />
        <StatCard icon={CircleDollarSign} label="Operating costs" value={formatMoney(stats.operatingTotal)} note="Recorded to date" />
      </div>
      <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><div className="panel-kicker">COST TRACKER</div><h2>Operating expenses</h2></div><span className="chart-period">Last 6 months <ChevronDown size={14} /></span></div>
        {data.monthly.every((item) => item.fuel === 0 && item.maintenance === 0) ? <EmptyState icon={Activity} title="No expenses recorded yet" detail="Add fuel or service records to see your monthly costs here." /> : <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.monthly} margin={{ top: 10, right: 4, left: -18, bottom: 0 }}><defs><linearGradient id="fuelFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#35b887" stopOpacity={0.24} /><stop offset="100%" stopColor="#35b887" stopOpacity={0} /></linearGradient><linearGradient id="serviceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#edab54" stopOpacity={0.19} /><stop offset="100%" stopColor="#edab54" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0ee" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#929c98', fontSize: 12 }} dy={10} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#929c98', fontSize: 11 }} tickFormatter={(value) => new Intl.NumberFormat('en-GH', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 0 }).format(value)} /><Tooltip formatter={(value, name) => [formatMoney(value), name === 'fuel' ? 'Fuel' : 'Maintenance']} contentStyle={{ borderRadius: 8, border: '1px solid #e8ece9', fontSize: 12 }} /><Area type="monotone" dataKey="fuel" stroke="#32a87e" strokeWidth={2.5} fill="url(#fuelFill)" /><Area type="monotone" dataKey="maintenance" stroke="#d99845" strokeWidth={2} fill="url(#serviceFill)" /></AreaChart></ResponsiveContainer></div>}
        <div className="chart-legend"><span><i className="legend-dot fuel-dot" /> Fuel</span><span><i className="legend-dot maintenance-dot" /> Maintenance</span><span className="chart-total">Total recorded: {formatMoney(stats.operatingTotal)}</span></div>
      </section>
        <section className="panel reminder-panel"><div className="panel-heading"><div><div className="panel-kicker">SERVICE SCHEDULE</div><h2>Needs attention</h2></div><Bell size={18} className="muted-icon" /></div>
          {data.overdue.length === 0 && data.upcoming.length === 0 ? <EmptyState icon={Check} title="You're up to date" detail="Scheduled service reminders will appear here." /> : <div className="reminder-list">{[...data.overdue.map((record) => ({ ...record, overdue: true })), ...data.upcoming].map((record) => <div className="reminder-item" key={record._id}><span className={`reminder-symbol ${record.overdue ? 'overdue' : ''}`}><Wrench size={16} /></span><div className="reminder-copy"><strong>{vehicleName(record.vehicleId)}</strong><small>{record.serviceType} · {record.nextServiceDate ? shortDate(record.nextServiceDate) : `at ${Number(record.nextServiceOdometer).toLocaleString()} km`}</small></div><span className={`status-pill ${record.overdue ? 'status-overdue' : 'status-soon'}`}>{record.overdue ? 'Overdue' : 'Soon'}</span></div>)}</div>}
          <NavLink to="/maintenance" className="panel-link">View maintenance schedule <ArrowUpRight size={15} /></NavLink>
        </section></div>
      <div className="dashboard-grid lower-grid"><section className="panel"><div className="panel-heading"><div><div className="panel-kicker">LATEST ACTIVITY</div><h2>Recent fuel purchases</h2></div><NavLink to="/fuel" className="text-link">See all <ArrowUpRight size={14} /></NavLink></div><ActivityTable items={data.recentFuel} kind="fuel" /></section>
        <section className="panel"><div className="panel-heading"><div><div className="panel-kicker">LATEST ACTIVITY</div><h2>Recent maintenance</h2></div><NavLink to="/maintenance" className="text-link">See all <ArrowUpRight size={14} /></NavLink></div><ActivityTable items={data.recentMaintenance} kind="maintenance" /></section>
        <section className="panel"><div className="panel-heading"><div><div className="panel-kicker">FLEET STATUS</div><h2>Vehicles on the road</h2></div><NavLink to="/vehicles" className="text-link">Fleet list <ArrowUpRight size={14} /></NavLink></div><VehicleMiniList vehicles={data.vehicles.slice(0, 5)} /></section></div>
    </>}
  </>
}

function VehicleMiniList({ vehicles }) {
  if (!vehicles.length) return <EmptyState icon={Truck} title="Your fleet starts here" detail="Register your first delivery vehicle to get organized." action={<NavLink to="/vehicles" className="text-link">Add a vehicle <ArrowUpRight size={14} /></NavLink>} />
  return <div className="vehicle-mini-list">{vehicles.map((vehicle) => <NavLink to={`/vehicles/${vehicle._id}`} className="vehicle-mini" key={vehicle._id}><span className="vehicle-type-icon"><VehicleIcon type={vehicle.vehicleType} /></span><span className="vehicle-mini-copy"><strong>{vehicle.registrationNumber}</strong><small>{[vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vehicleType}</small></span><span className={`status-pill status-${vehicle.status}`}>{vehicle.status}</span><ArrowUpRight size={14} className="muted-icon" /></NavLink>)}</div>
}

function VehicleIcon({ type }) { const Icon = type === 'motorcycle' ? Bike : CarFront; return <Icon size={18} /> }
function ActivityTable({ items, kind }) {
  const formatMoney = useMoney()
  if (!items.length) return <EmptyState icon={kind === 'fuel' ? Fuel : Wrench} title={`No ${kind} records yet`} detail="Recorded activity will appear here." />
  return <div className="activity-list">{items.map((item) => <div className="activity-row" key={item._id}><span className={`activity-icon ${kind}`} >{kind === 'fuel' ? <Fuel size={16} /> : <Wrench size={16} />}</span><div className="activity-description"><strong>{vehicleName(item.vehicleId)}</strong><small>{shortDate(kind === 'fuel' ? item.date : item.serviceDate)} · {kind === 'fuel' ? item.fuelStation || 'Fuel purchase' : item.serviceType}</small></div><strong className="activity-amount">{formatMoney(item.amount)}</strong></div>)}</div>
}

function Field({ label, value, onChange, type = 'text', required, min, max, minLength, placeholder, options, step }) {
  return <label className="field"><span>{label}{required && <i> *</i>}</span>{options ? <select required={required} value={value ?? ''} onChange={(event) => onChange(event.target.value)}><option value="">Select {label.toLowerCase()}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : type === 'textarea' ? <textarea required={required} value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows="3" /> : <input required={required} minLength={minLength} type={type} min={min} max={max} step={step} value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>
}

function Modal({ title, children, onClose, wide = false }) {
  useEffect(() => { function onKey(event) { if (event.key === 'Escape') onClose() } window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><div className="panel-kicker">FLEETCARE RECORD</div><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>{children}</section></div>
}

const vehicleTypes = ['motorcycle', 'tricycle', 'van', 'pickup', 'truck', 'other'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))
function Vehicles() {
  const [items, setItems] = useState([]); const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [editing, setEditing] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [reload, setReload] = useState(0)
  useEffect(() => { request('/vehicles').then(setItems).catch((issue) => setError(issue.message)) }, [reload])
  const visible = items.filter((item) => `${item.registrationNumber} ${item.make} ${item.model} ${item.assignedDriver}`.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || item.status === status))
  async function save(values) { setBusy(true); setError(''); try { await request(editing?._id ? `/vehicles/${editing._id}` : '/vehicles', { method: editing?._id ? 'PATCH' : 'POST', body: JSON.stringify(values) }); setEditing(null); setReload(reload + 1) } catch (issue) { setError(issue.message) } finally { setBusy(false) } }
  async function remove(item) { if (!window.confirm(`Delete ${item.registrationNumber}? This cannot be undone.`)) return; try { await request(`/vehicles/${item._id}`, { method: 'DELETE' }); setReload(reload + 1); setError('') } catch (issue) { setError(issue.message) } }
  return <><PageHeading eyebrow="YOUR DELIVERY FLEET" title="Vehicles" description="Keep vehicle details, status, and service history together." action={<button className="button button-primary" onClick={() => setEditing({})}><Plus size={17} /> Register vehicle</button>} /><ErrorNotice error={error} />
    <section className="panel table-panel"><div className="table-toolbar"><div className="search-box"><Search size={17} /><input placeholder="Search fleet..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><select aria-label="Filter by status" className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="maintenance">In maintenance</option><option value="inactive">Inactive</option></select><span className="result-count">{visible.length} vehicles</span></div>
      {!items.length ? <EmptyState icon={Truck} title="No vehicles registered" detail="Add your delivery vehicles to start tracking costs and servicing." action={<button className="button button-primary" onClick={() => setEditing({})}><Plus size={16} /> Register vehicle</button>} /> : visible.length === 0 ? <EmptyState icon={Search} title="No matches" detail="Try another search or status filter." /> : <div className="table-scroll"><table><thead><tr><th>VEHICLE</th><th>REGISTRATION</th><th>DRIVER</th><th>ODOMETER</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((item) => <tr key={item._id}><td><NavLink to={`/vehicles/${item._id}`} className="table-vehicle"><span className="vehicle-type-icon"><VehicleIcon type={item.vehicleType} /></span><span><strong>{[item.make, item.model].filter(Boolean).join(' ') || item.vehicleType}</strong><small>{item.year || 'Year not set'} · {item.vehicleType}</small></span></NavLink></td><td className="registration-cell">{item.registrationNumber}</td><td>{item.assignedDriver || <span className="muted-text">Unassigned</span>}</td><td>{Number(item.currentOdometer || 0).toLocaleString()} km</td><td><span className={`status-pill status-${item.status}`}>{item.status}</span></td><td><div className="row-actions"><button className="icon-button" title="Edit vehicle" onClick={() => setEditing(item)}><Settings size={15} /></button><button className="icon-button danger-hover" title="Delete vehicle" onClick={() => remove(item)}><X size={16} /></button></div></td></tr>)}</tbody></table></div>}
    </section>{editing && <VehicleModal item={editing} onClose={() => setEditing(null)} onSave={save} busy={busy} />}</>
}

function VehicleModal({ item, onClose, onSave, busy }) {
  const [form, setForm] = useState({ registrationNumber: '', vehicleType: 'van', make: '', model: '', year: '', currentOdometer: 0, assignedDriver: '', status: 'active', notes: '', ...item })
  function update(key, value) { setForm({ ...form, [key]: value }) }
  return <Modal title={item._id ? 'Edit vehicle details' : 'Register a vehicle'} onClose={onClose} wide><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, year: form.year ? Number(form.year) : undefined, currentOdometer: Number(form.currentOdometer) }) }}>
    <div className="form-grid"><Field label="Registration number" value={form.registrationNumber} onChange={(value) => update('registrationNumber', value.toUpperCase())} required placeholder="e.g. ABC 123" /><Field label="Vehicle type" value={form.vehicleType} onChange={(value) => update('vehicleType', value)} required options={vehicleTypes} /><Field label="Make" value={form.make} onChange={(value) => update('make', value)} placeholder="e.g. Toyota" /><Field label="Model" value={form.model} onChange={(value) => update('model', value)} placeholder="e.g. HiAce" /><Field label="Year" type="number" min="1900" max="2100" value={form.year} onChange={(value) => update('year', value)} placeholder="2022" /><Field label="Current odometer (km)" type="number" min="0" value={form.currentOdometer} onChange={(value) => update('currentOdometer', value)} required /><Field label="Assigned driver" value={form.assignedDriver} onChange={(value) => update('assignedDriver', value)} placeholder="Optional" /><Field label="Status" value={form.status} onChange={(value) => update('status', value)} options={[{ value: 'active', label: 'Active' }, { value: 'maintenance', label: 'In maintenance' }, { value: 'inactive', label: 'Inactive' }]} /><div className="field-span"><Field label="Notes" type="textarea" value={form.notes} onChange={(value) => update('notes', value)} placeholder="Useful details about this vehicle" /></div></div>
    <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving...' : item._id ? 'Save changes' : 'Register vehicle'}</button></div>
  </form></Modal>
}

const serviceTypes = ['Routine servicing', 'Oil change', 'Tyre replacement', 'Brake repairs', 'Engine repairs', 'Electrical repairs', 'General repairs', 'Other'].map((value) => ({ value, label: value }))
function Records({ kind }) {
  const formatMoney = useMoney()
  const isFuel = kind === 'fuel'; const endpoint = isFuel ? '/fuel' : '/maintenance'
  const [items, setItems] = useState([]); const [vehicles, setVehicles] = useState([]); const [vehicleFilter, setVehicleFilter] = useState('all'); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [editing, setEditing] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [reload, setReload] = useState(0)
  useEffect(() => { Promise.all([request(endpoint), request('/vehicles')]).then(([records, fleet]) => { setItems(records); setVehicles(fleet) }).catch((issue) => setError(issue.message)) }, [endpoint, reload])
  const visible = items.filter((item) => { const date = (isFuel ? item.date : item.serviceDate).slice(0, 10); return (vehicleFilter === 'all' || (item.vehicleId?._id || item.vehicleId) === vehicleFilter) && (!from || date >= from) && (!to || date <= to) })
  const total = visible.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  async function save(values) { setBusy(true); setError(''); try { await request(editing?._id ? `${endpoint}/${editing._id}` : endpoint, { method: editing?._id ? 'PATCH' : 'POST', body: JSON.stringify(values) }); setEditing(null); setReload(reload + 1) } catch (issue) { setError(issue.message) } finally { setBusy(false) } }
  async function remove(item) { if (!window.confirm('Delete this record?')) return; try { await request(`${endpoint}/${item._id}`, { method: 'DELETE' }); setReload(reload + 1) } catch (issue) { setError(issue.message) } }
  return <><PageHeading eyebrow={isFuel ? 'FUEL & RUNNING COSTS' : 'SERVICE & REPAIRS'} title={isFuel ? 'Fuel records' : 'Maintenance'} description={isFuel ? 'Record each fill-up and keep fuel spend visible across your fleet.' : 'Keep repairs and service schedules from slipping through the cracks.'} action={<button className="button button-primary" onClick={() => setEditing({})}><Plus size={17} /> {isFuel ? 'Add fuel record' : 'Log maintenance'}</button>} /><ErrorNotice error={error} />
    <div className="records-summary"><div className="records-total-icon">{isFuel ? <Fuel size={19} /> : <Wrench size={19} />}</div><div><small>{isFuel ? 'FILTERED FUEL SPEND' : 'FILTERED SERVICE SPEND'}</small><strong>{formatMoney(total)}</strong></div><span>{visible.length} {visible.length === 1 ? 'record' : 'records'}</span></div>
    <section className="panel table-panel"><div className="table-toolbar"><select className="filter-select" value={vehicleFilter} onChange={(event) => setVehicleFilter(event.target.value)}><option value="all">All vehicles</option>{vehicles.map((vehicle) => <option value={vehicle._id} key={vehicle._id}>{vehicle.registrationNumber}</option>)}</select><label className="date-filter"><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="date-filter"><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>
      {!items.length ? <EmptyState icon={isFuel ? Fuel : Wrench} title={`No ${isFuel ? 'fuel' : 'maintenance'} records yet`} detail={vehicles.length ? 'Add your first record to start tracking operating costs.' : 'Register a vehicle before recording expenses.'} action={vehicles.length ? <button className="button button-primary" onClick={() => setEditing({})}><Plus size={16} /> Add a record</button> : <NavLink to="/vehicles" className="button button-primary"><Plus size={16} /> Register vehicle</NavLink>} /> : visible.length === 0 ? <EmptyState icon={Search} title="No records match these filters" detail="Adjust the dates or choose another vehicle." /> : <div className="table-scroll"><table><thead><tr><th>DATE</th><th>VEHICLE</th><th>{isFuel ? 'FUEL DETAILS' : 'SERVICE'}</th><th>ODOMETER</th><th>AMOUNT</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((item) => <tr key={item._id}><td>{shortDate(isFuel ? item.date : item.serviceDate)}</td><td className="registration-cell">{vehicleName(item.vehicleId)}</td><td>{isFuel ? <><strong>{item.litres} L</strong><small className="table-subline">{item.fuelStation || 'Station not set'}</small></> : <><strong>{item.serviceType}</strong><small className="table-subline">{item.description || item.serviceProvider || 'Service record'}</small></>}</td><td>{Number(item.odometer).toLocaleString()} km</td><td className="amount-cell">{formatMoney(item.amount)}</td><td><div className="row-actions"><button className="icon-button" title="Edit record" onClick={() => setEditing(item)}><Settings size={15} /></button><button className="icon-button danger-hover" title="Delete record" onClick={() => remove(item)}><X size={16} /></button></div></td></tr>)}</tbody></table></div>}
    </section>{editing && <RecordModal item={editing} vehicles={vehicles} kind={kind} onClose={() => setEditing(null)} onSave={save} busy={busy} />}</>
}

function RecordModal({ item, vehicles, kind, onClose, onSave, busy }) {
  const isFuel = kind === 'fuel'
  const currency = useCurrency()
  const [form, setForm] = useState(() => createRecordForm(item))
  function update(key, value) { setForm({ ...form, [key]: value }) }
  return <Modal title={item._id ? `Edit ${isFuel ? 'fuel' : 'maintenance'} record` : `Add ${isFuel ? 'fuel purchase' : 'service record'}`} onClose={onClose} wide><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const values = { ...form, amount: Number(form.amount), odometer: Number(form.odometer), ...(isFuel ? { litres: Number(form.litres) } : { nextServiceOdometer: form.nextServiceOdometer ? Number(form.nextServiceOdometer) : undefined }) }; onSave(values) }}>
    <div className="form-grid"><Field label="Vehicle" value={form.vehicleId} onChange={(value) => update('vehicleId', value)} required options={vehicles.map((vehicle) => ({ value: vehicle._id, label: `${vehicle.registrationNumber} · ${vehicle.make || vehicle.vehicleType}` }))} /><Field label={isFuel ? 'Purchase date' : 'Service date'} type="date" value={isFuel ? form.date : form.serviceDate} onChange={(value) => update(isFuel ? 'date' : 'serviceDate', value)} required /><Field label="Odometer (km)" type="number" min="0" value={form.odometer} onChange={(value) => update('odometer', value)} required /><Field label={`Amount paid (${currency})`} type="number" min="0" step="0.01" value={form.amount} onChange={(value) => update('amount', value)} required />
      {isFuel ? <><Field label="Fuel quantity (litres)" type="number" min="0.01" step="0.01" value={form.litres} onChange={(value) => update('litres', value)} required /><Field label="Fuel station" value={form.fuelStation} onChange={(value) => update('fuelStation', value)} placeholder="Optional" /></> : <><Field label="Service category" value={form.serviceType} onChange={(value) => update('serviceType', value)} required options={serviceTypes} /><Field label="Mechanic or provider" value={form.serviceProvider} onChange={(value) => update('serviceProvider', value)} placeholder="Optional" /><Field label="Next service date" type="date" value={form.nextServiceDate ? String(form.nextServiceDate).slice(0, 10) : ''} onChange={(value) => update('nextServiceDate', value)} /><Field label="Next service odometer (km)" type="number" min="0" value={form.nextServiceOdometer} onChange={(value) => update('nextServiceOdometer', value)} /><div className="field-span"><Field label="Work description" type="textarea" value={form.description} onChange={(value) => update('description', value)} placeholder="What was checked or repaired?" /></div></>}
      <div className="field-span"><Field label="Notes" type="textarea" value={form.notes} onChange={(value) => update('notes', value)} placeholder="Additional details" /></div></div>
    <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy || !vehicles.length}>{busy ? 'Saving...' : item._id ? 'Save changes' : 'Save record'}</button></div>
  </form></Modal>
}

function VehicleProfile() {
  const formatMoney = useMoney()
  const { id } = useParams(); const [data, setData] = useState(null); const [error, setError] = useState('')
  useEffect(() => { request(`/vehicles/${id}/history`).then(setData).catch((issue) => setError(issue.message)) }, [id])
  if (!data && !error) return <LoadingLine />
  if (error) return <><NavLink to="/vehicles" className="text-link"><ArrowDownRight size={14} /> Back to vehicles</NavLink><ErrorNotice error={error} /></>
  const { vehicle, fuel, maintenance } = data
  const fuelTotal = fuel.reduce((sum, item) => sum + item.amount, 0); const serviceTotal = maintenance.reduce((sum, item) => sum + item.amount, 0)
  const timeline = [...fuel.map((item) => ({ ...item, kind: 'fuel', at: item.date })), ...maintenance.map((item) => ({ ...item, kind: 'maintenance', at: item.serviceDate }))].sort((a, b) => new Date(b.at) - new Date(a.at))
  return <><NavLink to="/vehicles" className="back-link"><ArrowDownRight size={15} /> All vehicles</NavLink><PageHeading eyebrow="VEHICLE PROFILE" title={vehicle.registrationNumber} description={[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' · ') || vehicle.vehicleType} action={<span className={`status-pill status-${vehicle.status}`}>{vehicle.status}</span>} />
    <div className="profile-stats"><StatCard icon={Fuel} label="Fuel expenditure" value={formatMoney(fuelTotal)} note={`${fuel.length} records`} tone="blue" /><StatCard icon={Wrench} label="Maintenance spend" value={formatMoney(serviceTotal)} note={`${maintenance.length} records`} tone="amber" /><StatCard icon={CircleDollarSign} label="Total operating costs" value={formatMoney(fuelTotal + serviceTotal)} note="Recorded to date" /></div>
    <div className="dashboard-grid profile-grid"><section className="panel"><div className="panel-heading"><div><div className="panel-kicker">VEHICLE DETAILS</div><h2>At a glance</h2></div><VehicleIcon type={vehicle.vehicleType} /></div><div className="detail-list"><Detail label="Vehicle type" value={vehicle.vehicleType} /><Detail label="Driver" value={vehicle.assignedDriver || 'Unassigned'} /><Detail label="Odometer" value={`${Number(vehicle.currentOdometer).toLocaleString()} km`} /><Detail label="Registered" value={shortDate(vehicle.createdAt)} />{vehicle.notes && <Detail label="Notes" value={vehicle.notes} />}</div></section>
      <section className="panel"><div className="panel-heading"><div><div className="panel-kicker">VEHICLE HISTORY</div><h2>Recent activity</h2></div><span className="result-count">{timeline.length} entries</span></div>{timeline.length ? <div className="timeline">{timeline.map((item) => <div className="timeline-row" key={`${item.kind}-${item._id}`}><span className={`activity-icon ${item.kind}`}>{item.kind === 'fuel' ? <Fuel size={16} /> : <Wrench size={16} />}</span><div className="timeline-copy"><strong>{item.kind === 'fuel' ? `${item.litres} L fuel purchase` : item.serviceType}</strong><small>{shortDate(item.at)} · {Number(item.odometer).toLocaleString()} km</small></div><strong>{formatMoney(item.amount)}</strong></div>)}</div> : <EmptyState icon={Activity} title="No history recorded" detail="Fuel purchases and maintenance entries appear here." />}</section></div>
  </>
}
function Detail({ label, value }) { return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div> }

function Reports() {
  const formatMoney = useMoney()
  const currency = useCurrency()
  const [data, setData] = useState({ vehicles: [], fuel: [], maintenance: [] }); const [error, setError] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  useEffect(() => { Promise.all([request('/vehicles'), request('/fuel'), request('/maintenance')]).then(([vehicles, fuel, maintenance]) => setData({ vehicles, fuel, maintenance })).catch((issue) => setError(issue.message)) }, [])
  const filterDate = (item, date) => (!from || new Date(date) >= new Date(`${from}T00:00:00`)) && (!to || new Date(date) <= new Date(`${to}T23:59:59`))
  const fuel = data.fuel.filter((item) => filterDate(item, item.date)); const maintenance = data.maintenance.filter((item) => filterDate(item, item.serviceDate))
  const totalFuel = fuel.reduce((sum, item) => sum + item.amount, 0); const totalService = maintenance.reduce((sum, item) => sum + item.amount, 0)
  const vehicleRows = data.vehicles.map((vehicle) => { const vehicleFuel = fuel.filter((item) => (item.vehicleId?._id || item.vehicleId) === vehicle._id).reduce((sum, item) => sum + item.amount, 0); const vehicleService = maintenance.filter((item) => (item.vehicleId?._id || item.vehicleId) === vehicle._id).reduce((sum, item) => sum + item.amount, 0); return { vehicle, fuel: vehicleFuel, maintenance: vehicleService, total: vehicleFuel + vehicleService } }).sort((a, b) => b.total - a.total)
  function exportCsv() { const lines = [['Vehicle', `Fuel spend (${currency})`, `Maintenance spend (${currency})`, `Total operating cost (${currency})`], ...vehicleRows.map(({ vehicle, fuel: fuelAmount, maintenance: serviceAmount, total }) => [vehicle.registrationNumber, fuelAmount.toFixed(2), serviceAmount.toFixed(2), total.toFixed(2)])]; const csv = lines.map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(',')).join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'fleetcare-expenses.csv'; link.click(); URL.revokeObjectURL(link.href) }
  return <><PageHeading eyebrow="COST VISIBILITY" title="Reports" description="Understand what it costs to keep each delivery vehicle moving." action={<button className="button button-outline" onClick={exportCsv} disabled={!vehicleRows.length}><FileDown size={16} /> Export CSV</button>} /><ErrorNotice error={error} />
    <section className="panel report-filters"><CalendarDays size={18} /><strong>Date range</strong><label className="date-filter"><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="date-filter"><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="text-link" onClick={() => { setFrom(''); setTo('') }}>Clear</button></section>
    <div className="stat-grid report-stat-grid"><StatCard icon={Fuel} label="Fuel expenditure" value={formatMoney(totalFuel)} note={`${fuel.length} purchases`} tone="blue" /><StatCard icon={Wrench} label="Maintenance expenditure" value={formatMoney(totalService)} note={`${maintenance.length} services`} tone="amber" /><StatCard icon={CircleDollarSign} label="Operating costs" value={formatMoney(totalFuel + totalService)} note="Selected date range" tone="green" /></div>
    <section className="panel table-panel"><div className="panel-heading report-table-heading"><div><div className="panel-kicker">VEHICLE COST BREAKDOWN</div><h2>Operating spend by vehicle</h2></div></div>{!vehicleRows.length ? <EmptyState icon={Truck} title="No vehicle data yet" detail="Register vehicles and record costs to see a breakdown." action={<NavLink to="/vehicles" className="button button-primary"><Plus size={16} /> Add a vehicle</NavLink>} /> : <div className="table-scroll"><table><thead><tr><th>VEHICLE</th><th>FUEL</th><th>MAINTENANCE</th><th>TOTAL COST</th></tr></thead><tbody>{vehicleRows.map(({ vehicle, fuel: fuelAmount, maintenance: serviceAmount, total }) => <tr key={vehicle._id}><td><NavLink to={`/vehicles/${vehicle._id}`} className="table-vehicle"><span className="vehicle-type-icon"><VehicleIcon type={vehicle.vehicleType} /></span><span><strong>{vehicle.registrationNumber}</strong><small>{[vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vehicleType}</small></span></NavLink></td><td>{formatMoney(fuelAmount)}</td><td>{formatMoney(serviceAmount)}</td><td className="amount-cell">{formatMoney(total)}</td></tr>)}</tbody></table></div>}</section>
  </>
}

function SettingsPage() {
  const { user, signOut, updateUser } = useAuth()
  const { appearance, chooseAppearance } = useAppearance()
  const [currency, setCurrency] = useState(user.currency || 'GHS')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  async function saveCurrency(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await updateUser({ currency })
      setSaved(true)
    } catch (issue) {
      setError(issue.message)
    } finally {
      setSaving(false)
    }
  }
  return <><PageHeading eyebrow="ACCOUNT & BUSINESS" title="Settings" description="Your FleetCare business workspace and account details." /><section className="panel settings-panel"><div className="settings-icon"><BriefcaseBusiness size={20} /></div><div className="settings-copy"><div className="panel-kicker">BUSINESS ACCOUNT</div><h2>{user.businessName}</h2><p>Business records are private to this account.</p></div><span className="security-badge"><ShieldCheck size={15} /> Protected</span><div className="settings-details"><Detail label="Business name" value={user.businessName} /><Detail label="Owner or manager" value={user.ownerName} /><Detail label="Email address" value={user.email} /></div><form className="currency-setting" onSubmit={saveCurrency}><Field label="Display currency" value={currency} onChange={(value) => { setCurrency(value); setSaved(false) }} options={currencyOptions} /><p className="currency-note">New accounts use Ghana cedis (GHS). Changing this setting changes the currency used to display and enter amounts; it does not convert existing records.</p><button className="button button-primary" disabled={saving || currency === (user.currency || 'GHS')}>{saving ? 'Saving...' : 'Save currency'}</button>{saved && <span className="currency-saved" role="status">Currency saved</span>}{error && <span className="form-error" role="alert">{error}</span>}</form><div className="appearance-setting"><div><div className="panel-kicker">APPEARANCE</div><h3>Appearance mode</h3><p>Choose FleetCare’s colors or follow your device setting.</p></div><Field label="Theme" value={appearance} onChange={chooseAppearance} options={appearanceOptions} /></div><button className="button button-outline signout-button" onClick={signOut}><LogOut size={16} /> Sign out</button></section></>
}

export default App
