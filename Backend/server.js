import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { execFileSync } from 'node:child_process'
import errorHandler from './middleware/errorHandler.js'
import createApiRouter from './routes/api.js'

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

function serviceStatus() {
  return { service: 'FleetCare API', status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }
}

app.get('/', (_req, res) => res.json(serviceStatus()))
app.get('/api/health', (_req, res) => res.json(serviceStatus()))

app.use('/api', createApiRouter({
  Business,
  Vehicle,
  FuelRecord,
  MaintenanceRecord,
  authenticate,
  issueToken,
  publicBusiness,
  currencies,
}))
app.use(errorHandler)

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