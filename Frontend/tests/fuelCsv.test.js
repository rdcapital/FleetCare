import test from 'node:test'
import assert from 'node:assert/strict'
import { fuelEfficiencyByVehicle, parseFuelCsv } from '../src/utils/fuelCsv.js'

const vehicles = [{ _id: 'vehicle-1', registrationNumber: 'GH-1234-24' }]

test('parses valid fuel CSV rows and quoted commas', () => {
  const rows = parseFuelCsv(
    'registrationNumber,date,odometer,litres,amount,fuelStation,notes\nGH-1234-24,2026-01-01,1000,30,450,"Station, East","route, morning"',
    vehicles,
    [],
  )
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].record, {
    vehicleId: 'vehicle-1',
    date: '2026-01-01',
    odometer: 1000,
    litres: 30,
    amount: 450,
    fuelStation: 'Station, East',
    notes: 'route, morning',
  })
})

test('returns row errors for unknown vehicles, invalid dates, and duplicate records', () => {
  const rows = parseFuelCsv(
    'registrationNumber,date,odometer,litres,amount\nUNKNOWN,2026-01-01,1000,30,450\nGH-1234-24,2026-02-30,1100,30,450\nGH-1234-24,2026-01-01,1000,30,450\nGH-1234-24,2026-01-01,1000,30,450\n',
    vehicles,
    [],
  )
  assert.match(rows[0].error, /not in your FleetCare list/)
  assert.match(rows[1].error, /real date/)
  assert.equal(rows[2].error, undefined)
  assert.match(rows[3].error, /repeated in this file/)
})

test('estimates fuel efficiency and trend from ordered odometer entries', () => {
  const analysis = fuelEfficiencyByVehicle([
    { vehicleId: 'vehicle-1', date: '2026-01-01', odometer: 1000, litres: 10 },
    { vehicleId: 'vehicle-1', date: '2026-02-01', odometer: 1100, litres: 12 },
    { vehicleId: 'vehicle-1', date: '2026-03-01', odometer: 1200, litres: 8 },
    { vehicleId: 'vehicle-1', date: '2026-04-01', odometer: 1300, litres: 7 },
  ], vehicles)
  assert.equal(analysis.length, 1)
  assert.equal(analysis[0].average, 9)
  assert.equal(analysis[0].changePercent, -37.5)
})

test('shows an average but waits for more intervals before comparing a trend', () => {
  const analysis = fuelEfficiencyByVehicle([
    { vehicleId: 'vehicle-1', date: '2026-01-01', odometer: 1000, litres: 10 },
    { vehicleId: 'vehicle-1', date: '2026-02-01', odometer: 1100, litres: 12 },
    { vehicleId: 'vehicle-1', date: '2026-03-01', odometer: 1200, litres: 8 },
  ], vehicles)
  assert.equal(analysis[0].average, 10)
  assert.equal(analysis[0].changePercent, null)
})
