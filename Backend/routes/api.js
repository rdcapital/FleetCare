import express from 'express'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id)
}

function pickFields(body, allowed) {
  const values = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  return Object.fromEntries(allowed.filter((field) => Object.hasOwn(values, field)).map((field) => [field, values[field]]))
}

export default function createApiRouter({
  Business,
  Vehicle,
  FuelRecord,
  MaintenanceRecord,
  authenticate,
  issueToken,
  publicBusiness,
  currencies,
}) {
  const router = express.Router()

  router.post('/auth/register', async (req, res, next) => {
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

  router.post('/auth/login', async (req, res, next) => {
    try {
      const email = String(req.body.email || '').toLowerCase().trim()
      const user = await Business.findOne({ email })
      if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) {
        return res.status(401).json({ message: 'Email or password is incorrect.' })
      }
      res.json({ token: issueToken(user), user: publicBusiness(user) })
    } catch (error) { next(error) }
  })

  router.get('/auth/me', authenticate, (req, res) => res.json(publicBusiness(req.business)))

  router.patch('/auth/me', authenticate, async (req, res, next) => {
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

  async function ensureOwnedVehicle(vehicleId, businessId) {
    return isValidId(vehicleId) && Vehicle.exists({ _id: vehicleId, businessId })
  }

  for (const [resource, { model, dateField, fields }] of Object.entries(collections)) {
    router.get(`/${resource}`, authenticate, async (req, res, next) => {
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
        const query = model.find(filter).sort({ [dateField]: -1 })
        if (resource !== 'vehicles') query.populate('vehicleId', 'registrationNumber make model')
        const records = await query
        res.json(records)
      } catch (error) { next(error) }
    })

    router.post(`/${resource}`, authenticate, async (req, res, next) => {
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

    router.patch(`/${resource}/:id`, authenticate, async (req, res, next) => {
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

    router.delete(`/${resource}/:id`, authenticate, async (req, res, next) => {
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

  router.get('/vehicles/:id/history', authenticate, async (req, res, next) => {
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

  router.get('/dashboard', authenticate, async (req, res, next) => {
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

  return router
}
