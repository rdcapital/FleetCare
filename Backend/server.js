import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { execFileSync } from 'node:child_process'

const app = express()
const port = process.env.PORT || 4000
const secret = process.env.JWT_SECRET
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL
const currencies = ['GHS', 'USD', 'GBP', 'EUR', 'NGN', 'XOF', 'ZAR']

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '1mb' }))

function resolveMongoSrvWithWindows(uri) {
  const parsedUri = new URL(uri)
  const hostname = parsedUri.hostname
  if (!/^[a-z0-9.-]+$/i.test(hostname)) throw new Error('Invalid MongoDB SRV hostname.')

  const script = `& { param($domain) $ErrorActionPreference = 'Stop'; $srv = @(Resolve-DnsName -Name ("_mongodb._tcp." + $domain) -Type SRV -DnsOnly -ErrorAction Stop | Select-Object NameTarget, Port, Priority, Weight); $txt = @(Resolve-DnsName -Name $domain -Type TXT -DnsOnly -ErrorAction Stop | ForEach-Object { ($_.Strings -join '') }); [ordered]@{ srv = $srv; txt = $txt } | ConvertTo-Json -Compress -Depth 4 } ${hostname}`
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  })
  const records = JSON.parse(output)
  const srvRecords = Array.isArray(records.srv) ? records.srv : [records.srv]
  const txtRecords = Array.isArray(records.txt) ? records.txt : [records.txt]
  if (!srvRecords.length || !srvRecords[0]?.NameTarget) {
    throw new Error('Windows DNS did not return MongoDB SRV records.')
  }

  const seeds = srvRecords.map(({ NameTarget, Port }) => {
    const host = String(NameTarget).replace(/\.$/, '')
    const port = Number(Port)
    if (!/^[a-z0-9.-]+$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Windows DNS returned an invalid MongoDB SRV record.')
    }
    return `${host}:${port}`
  })
  const options = new URLSearchParams(txtRecords.filter(Boolean).join('&'))
  for (const [key, value] of parsedUri.searchParams) options.set(key, value)
  options.set('tls', 'true')

  const credentials = parsedUri.username
    ? `${parsedUri.username}${parsedUri.password ? `:${parsedUri.password}` : ''}@`
    : ''
  return `mongodb://${credentials}${seeds.join(',')}${parsedUri.pathname || '/'}?${options}`
}

const userSchema = new mongoose.Schema({
  businessName: { type: String, required: true, trim: true },
  ownerName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  currency: { type: String, enum: currencies, default: 'GHS' },
}, { timestamps: true })

const vehicleSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  registrationNumber: { type: String, required: true, trim: true, uppercase: true },
  vehicleType: { type: String, enum: ['motorcycle', 'tricycle', 'van', 'pickup', 'truck', 'other'], required: true },
  make: { type: String, trim: true, default: '' },
  model: { type: String, trim: true, default: '' },
  year: { type: Number, min: 1900, max: 2100 },
  currentOdometer: { type: Number, min: 0, default: 0 },
  assignedDriver: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['active', 'maintenance', 'inactive'], default: 'active' },
  notes: { type: String, trim: true, default: '' },
}, { timestamps: true })
vehicleSchema.index({ businessId: 1, registrationNumber: 1 }, { unique: true })

const fuelSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Vehicle' },
  date: { type: Date, required: true },
  odometer: { type: Number, required: true, min: 0 },
  litres: { type: Number, required: true, min: 0.01 },
  amount: { type: Number, required: true, min: 0 },
  fuelStation: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
}, { timestamps: true })

const maintenanceSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Vehicle' },
  serviceDate: { type: Date, required: true },
  odometer: { type: Number, required: true, min: 0 },
  serviceType: { type: String, required: true, enum: ['Routine servicing', 'Oil change', 'Tyre replacement', 'Brake repairs', 'Engine repairs', 'Electrical repairs', 'General repairs', 'Other'] },
  description: { type: String, trim: true, default: '' },
  amount: { type: Number, required: true, min: 0 },
  serviceProvider: { type: String, trim: true, default: '' },
  nextServiceDate: Date,
  nextServiceOdometer: { type: Number, min: 0 },
  notes: { type: String, trim: true, default: '' },
}, { timestamps: true })

const Business = mongoose.model('Business', userSchema)
const Vehicle = mongoose.model('Vehicle', vehicleSchema)
const FuelRecord = mongoose.model('FuelRecord', fuelSchema)
const MaintenanceRecord = mongoose.model('MaintenanceRecord', maintenanceSchema)

function issueToken(user) {
  return jwt.sign({ sub: user.id }, secret, { expiresIn: '7d' })
}

function publicBusiness(user) {
  return {
    id: user.id,
    businessName: user.businessName,
    ownerName: user.ownerName,
    email: user.email,
    currency: user.currency || 'GHS',
  }
}

async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ message: 'Please sign in to continue.' })
    const payload = jwt.verify(token, secret)
    const user = await Business.findById(payload.sub).select('-passwordHash')
    if (!user) return res.status(401).json({ message: 'Your session is no longer valid.' })
    req.business = user
    next()
  } catch {
    res.status(401).json({ message: 'Your session is no longer valid.' })
  }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }))

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { businessName, ownerName, email, password } = req.body
    if (![businessName, ownerName, email, password].every((value) => typeof value === 'string' && value.trim())) {
      return res.status(400).json({ message: 'Complete each required field.' })
    }
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      return res.status(400).json({ message: 'Use a valid email and a password of at least 8 characters.' })
    }
    const user = await Business.create({ businessName, ownerName, email, passwordHash: await bcrypt.hash(password, 12) })
    res.status(201).json({ token: issueToken(user), user: publicBusiness(user) })
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'An account already uses this email.' })
    next(error)
  }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim()
    const user = await Business.findOne({ email })
    if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) {
      return res.status(401).json({ message: 'Email or password is incorrect.' })
    }
    res.json({ token: issueToken(user), user: publicBusiness(user) })
  } catch (error) { next(error) }
})

app.get('/api/auth/me', authenticate, (req, res) => res.json(publicBusiness(req.business)))

app.patch('/api/auth/me', authenticate, async (req, res, next) => {
  try {
    const { currency } = req.body
    if (!currencies.includes(currency)) {
      return res.status(400).json({ message: 'Choose a supported currency.' })
    }
    req.business.currency = currency
    await req.business.save()
    res.json(publicBusiness(req.business))
  } catch (error) { next(error) }
})

const collections = {
  vehicles: { model: Vehicle, dateField: 'createdAt', fields: ['registrationNumber', 'vehicleType', 'make', 'model', 'year', 'currentOdometer', 'assignedDriver', 'status', 'notes'] },
  fuel: { model: FuelRecord, dateField: 'date', fields: ['vehicleId', 'date', 'odometer', 'litres', 'amount', 'fuelStation', 'notes'] },
  maintenance: { model: MaintenanceRecord, dateField: 'serviceDate', fields: ['vehicleId', 'serviceDate', 'odometer', 'serviceType', 'description', 'amount', 'serviceProvider', 'nextServiceDate', 'nextServiceOdometer', 'notes'] },
}

function isValidId(id) { return mongoose.Types.ObjectId.isValid(id) }
function pickFields(body, allowed) {
  const values = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  return Object.fromEntries(allowed.filter((field) => Object.hasOwn(values, field)).map((field) => [field, values[field]]))
}

async function ensureOwnedVehicle(vehicleId, businessId) {
  return isValidId(vehicleId) && Vehicle.exists({ _id: vehicleId, businessId })
}

for (const [resource, { model, dateField, fields }] of Object.entries(collections)) {
  app.get(`/api/${resource}`, authenticate, async (req, res, next) => {
    try {
      const filter = { businessId: req.business.id }
      if (req.query.vehicleId) {
        if (!isValidId(req.query.vehicleId)) return res.status(400).json({ message: 'Choose a valid vehicle.' })
        filter.vehicleId = req.query.vehicleId
      }
      if (req.query.from || req.query.to) {
        const from = req.query.from ? new Date(req.query.from) : null
        const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : null
        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) {
          return res.status(400).json({ message: 'Choose a valid date range.' })
        }
        filter[dateField] = {}
        if (from) filter[dateField].$gte = from
        if (to) filter[dateField].$lte = to
      }
      const records = await model.find(filter).sort({ [dateField]: -1 }).populate('vehicleId', 'registrationNumber make model')
      res.json(records)
    } catch (error) { next(error) }
  })

  app.post(`/api/${resource}`, authenticate, async (req, res, next) => {
    try {
      if (resource !== 'vehicles' && !(await ensureOwnedVehicle(req.body.vehicleId, req.business.id))) {
        return res.status(400).json({ message: 'Choose a vehicle belonging to your business.' })
      }
      const record = await model.create({ ...pickFields(req.body, fields), businessId: req.business.id })
      if (resource !== 'vehicles') {
        await Vehicle.updateOne({ _id: record.vehicleId, businessId: req.business.id }, { $max: { currentOdometer: record.odometer } })
      }
      res.status(201).json(record)
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'That registration number is already in use.' })
      if (error.name === 'ValidationError' || error.name === 'CastError') return res.status(400).json({ message: 'Check the values and try again.' })
      next(error)
    }
  })

  app.patch(`/api/${resource}/:id`, authenticate, async (req, res, next) => {
    try {
      if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Record not found.' })
      const updates = pickFields(req.body, fields)
      if (resource !== 'vehicles' && updates.vehicleId && !(await ensureOwnedVehicle(updates.vehicleId, req.business.id))) {
        return res.status(400).json({ message: 'Choose a vehicle belonging to your business.' })
      }
      const record = await model.findOneAndUpdate(
        { _id: req.params.id, businessId: req.business.id },
        { $set: updates },
        { new: true, runValidators: true },
      )
      if (!record) return res.status(404).json({ message: 'Record not found.' })
      if (resource !== 'vehicles') {
        await Vehicle.updateOne({ _id: record.vehicleId, businessId: req.business.id }, { $max: { currentOdometer: record.odometer } })
      }
      res.json(record)
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'That registration number is already in use.' })
      if (error.name === 'ValidationError' || error.name === 'CastError') return res.status(400).json({ message: 'Check the values and try again.' })
      next(error)
    }
  })

  app.delete(`/api/${resource}/:id`, authenticate, async (req, res, next) => {
    try {
      if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Record not found.' })
      if (resource === 'vehicles') {
        const [fuelCount, maintenanceCount] = await Promise.all([
          FuelRecord.countDocuments({ businessId: req.business.id, vehicleId: req.params.id }),
          MaintenanceRecord.countDocuments({ businessId: req.business.id, vehicleId: req.params.id }),
        ])
        if (fuelCount || maintenanceCount) return res.status(409).json({ message: 'This vehicle has records. Mark it inactive to preserve its history.' })
      }
      const record = await model.findOneAndDelete({ _id: req.params.id, businessId: req.business.id })
      if (!record) return res.status(404).json({ message: 'Record not found.' })
      res.status(204).end()
    } catch (error) { next(error) }
  })
}

app.get('/api/vehicles/:id/history', authenticate, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Vehicle not found.' })
    const vehicle = await Vehicle.findOne({ _id: req.params.id, businessId: req.business.id })
    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found.' })
    const [fuel, maintenance] = await Promise.all([
      FuelRecord.find({ businessId: req.business.id, vehicleId: vehicle.id }).sort({ date: -1 }),
      MaintenanceRecord.find({ businessId: req.business.id, vehicleId: vehicle.id }).sort({ serviceDate: -1 }),
    ])
    res.json({ vehicle, fuel, maintenance })
  } catch (error) { next(error) }
})

app.get('/api/dashboard', authenticate, async (req, res, next) => {
  try {
    const businessId = req.business.id
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const [vehicles, fuel, maintenance, recentFuel, recentMaintenance] = await Promise.all([
      Vehicle.find({ businessId }).sort({ updatedAt: -1 }),
      FuelRecord.find({ businessId }),
      MaintenanceRecord.find({ businessId }).populate('vehicleId', 'registrationNumber make model').sort({ serviceDate: -1 }),
      FuelRecord.find({ businessId }).populate('vehicleId', 'registrationNumber').sort({ date: -1 }).limit(5),
      MaintenanceRecord.find({ businessId }).populate('vehicleId', 'registrationNumber').sort({ serviceDate: -1 }).limit(5),
    ])
    const fuelTotal = fuel.reduce((sum, item) => sum + item.amount, 0)
    const maintenanceTotal = maintenance.reduce((sum, item) => sum + item.amount, 0)
    const fuelThisMonth = fuel.filter((item) => item.date >= monthStart).reduce((sum, item) => sum + item.amount, 0)
    const maintenanceThisMonth = maintenance.filter((item) => item.serviceDate >= monthStart).reduce((sum, item) => sum + item.amount, 0)
    const currentOdometerByVehicle = new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle.currentOdometer]))
    const scheduled = maintenance.filter((item) => item.nextServiceDate || item.nextServiceOdometer)
      .filter((item, index, list) => list.findIndex((candidate) => String(candidate.vehicleId.id) === String(item.vehicleId.id)) === index)
    const due = scheduled.filter((item) => (
      (item.nextServiceDate && item.nextServiceDate <= new Date(now.getTime() + 30 * 86400000)) ||
      (item.nextServiceOdometer && item.nextServiceOdometer <= (currentOdometerByVehicle.get(String(item.vehicleId.id)) || 0) + 500)
    ))
    const overdue = due.filter((item) => (
      (item.nextServiceDate && item.nextServiceDate < now) ||
      (item.nextServiceOdometer && item.nextServiceOdometer <= (currentOdometerByVehicle.get(String(item.vehicleId.id)) || 0))
    ))
    const monthly = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
      const key = `${date.getFullYear()}-${date.getMonth()}`
      return {
        month: date.toLocaleString('en', { month: 'short' }),
        fuel: fuel.filter((item) => `${item.date.getFullYear()}-${item.date.getMonth()}` === key).reduce((sum, item) => sum + item.amount, 0),
        maintenance: maintenance.filter((item) => `${item.serviceDate.getFullYear()}-${item.serviceDate.getMonth()}` === key).reduce((sum, item) => sum + item.amount, 0),
      }
    })
    res.json({
      stats: {
        totalVehicles: vehicles.length,
        activeVehicles: vehicles.filter((item) => item.status === 'active').length,
        maintenanceVehicles: vehicles.filter((item) => item.status === 'maintenance').length,
        fuelTotal, maintenanceTotal, operatingTotal: fuelTotal + maintenanceTotal,
        fuelThisMonth, maintenanceThisMonth,
      },
      vehicles, recentFuel, recentMaintenance, upcoming: due.filter((item) => !overdue.includes(item)).slice(0, 5), overdue: overdue.slice(0, 5), monthly,
    })
  } catch (error) { next(error) }
})

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
})

if (process.env.NODE_ENV !== 'test') {
  const configurationErrors = []
  if (!secret) configurationErrors.push('JWT_SECRET is missing; set it to a long, random secret.')
  if (!mongoUri) {
    configurationErrors.push('MONGODB_URI is missing; set it to your MongoDB Atlas connection string.')
  } else {
    try {
      const parsedUri = new URL(mongoUri)
      if (!['mongodb:', 'mongodb+srv:'].includes(parsedUri.protocol) || !parsedUri.hostname) throw new Error()
    } catch {
      configurationErrors.push('The MongoDB connection string is invalid; use a mongodb:// or mongodb+srv:// URI.')
    }
  }
  if (configurationErrors.length) {
    console.error(`Backend configuration error:\n- ${configurationErrors.join('\n- ')}`)
    process.exit(1)
  }
  async function startServer() {
    try {
      await mongoose.connect(mongoUri)
    } catch (error) {
      const needsWindowsSrvFallback = process.platform === 'win32'
        && mongoUri.startsWith('mongodb+srv://')
        && /querySrv\s+(ECONNREFUSED|ENOTFOUND|ETIMEOUT)/i.test(error.message)
      if (!needsWindowsSrvFallback) throw error
      console.warn('Node.js DNS could not resolve the Atlas SRV record; retrying with Windows DNS.')
      await mongoose.connect(resolveMongoSrvWithWindows(mongoUri))
    }
    app.listen(port, () => console.log(`FleetCare API listening on port ${port}`))
  }

  startServer().catch((error) => {
    console.error('MongoDB connection failed:', error.message)
    process.exit(1)
  })
}

export default app