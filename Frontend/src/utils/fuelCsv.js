function parseCsvRows(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
      if (character === '\r' && text[index + 1] === '\n') index += 1
    } else {
      cell += character
    }
  }

  if (quoted) throw new Error('The CSV has a quote that was never closed.')
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function normalizeHeader(value) {
  return value.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/[\s_-]+/g, '')
}

function parseDate(value) {
  const input = value.trim()
  let date
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input)
  if (iso) date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])))
  else if (us) date = new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])))
  else return null

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== (
    iso
      ? `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`
      : `${us[3]}-${String(us[1]).padStart(2, '0')}-${String(us[2]).padStart(2, '0')}`
  )) return null
  return date.toISOString().slice(0, 10)
}

function findHeader(headers, names) {
  return headers.findIndex((header) => names.includes(normalizeHeader(header)))
}

export function parseFuelCsv(text, vehicles, existingRecords) {
  const rows = parseCsvRows(text)
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one fuel record.')
  if (rows.length > 501) throw new Error('Import up to 500 fuel records at a time.')

  const headers = rows[0]
  const columns = {
    registrationNumber: findHeader(headers, ['registrationnumber', 'registration', 'vehicle']),
    date: findHeader(headers, ['date', 'purchasedate']),
    odometer: findHeader(headers, ['odometer', 'odometerkm']),
    litres: findHeader(headers, ['litres', 'liters', 'fuelquantity']),
    amount: findHeader(headers, ['amount', 'amountpaid', 'totalamount']),
    fuelStation: findHeader(headers, ['fuelstation', 'station']),
    notes: findHeader(headers, ['notes', 'note']),
  }
  const missing = ['registrationNumber', 'date', 'odometer', 'litres', 'amount']
    .filter((name) => columns[name] === -1)
  if (missing.length) {
    throw new Error(`Missing required columns: ${missing.join(', ')}. Download the template for the correct headings.`)
  }

  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.registrationNumber.trim().toUpperCase(), vehicle]))
  const seen = new Set(existingRecords.map((record) => {
    const vehicleId = record.vehicleId?._id || record.vehicleId
    return [vehicleId, new Date(record.date).toISOString().slice(0, 10), record.odometer, record.litres, record.amount].join('|')
  }))

  return rows.slice(1).map((cells, index) => {
    const rowNumber = index + 2
    const value = (name) => columns[name] === -1 ? '' : (cells[columns[name]] || '').trim()
    const registrationNumber = value('registrationNumber').toUpperCase()
    const vehicle = vehicleMap.get(registrationNumber)
    if (!vehicle) return { rowNumber, error: `Vehicle "${registrationNumber || '(blank)'}" is not in your FleetCare list.` }

    const date = parseDate(value('date'))
    if (!date) return { rowNumber, error: 'Date must be a real date in YYYY-MM-DD or MM/DD/YYYY format.' }
    if (!value('odometer')) return { rowNumber, error: 'Odometer is required.' }
    if (!value('litres')) return { rowNumber, error: 'Litres is required.' }
    if (!value('amount')) return { rowNumber, error: 'Amount is required.' }
    const odometer = Number(value('odometer'))
    const litres = Number(value('litres'))
    const amount = Number(value('amount'))
    if (!Number.isFinite(odometer) || odometer < 0) return { rowNumber, error: 'Odometer must be zero or more.' }
    if (!Number.isFinite(litres) || litres <= 0) return { rowNumber, error: 'Litres must be greater than zero.' }
    if (!Number.isFinite(amount) || amount < 0) return { rowNumber, error: 'Amount must be zero or more.' }

    const record = {
      vehicleId: vehicle._id,
      date,
      odometer,
      litres,
      amount,
      fuelStation: value('fuelStation'),
      notes: value('notes'),
    }
    const duplicateKey = [record.vehicleId, record.date, record.odometer, record.litres, record.amount].join('|')
    if (seen.has(duplicateKey)) return { rowNumber, error: 'This fuel record is already in FleetCare or repeated in this file.' }
    seen.add(duplicateKey)
    return { rowNumber, record }
  })
}

export function fuelEfficiencyByVehicle(records, vehicles) {
  return vehicles.map((vehicle) => {
    const vehicleRecords = records
      .filter((record) => (record.vehicleId?._id || record.vehicleId) === vehicle._id)
      .sort((left, right) => (
        new Date(left.date) - new Date(right.date) || Number(left.odometer) - Number(right.odometer)
      ))
    const intervals = []
    for (let index = 1; index < vehicleRecords.length; index += 1) {
      const previous = vehicleRecords[index - 1]
      const current = vehicleRecords[index]
      const distance = Number(current.odometer) - Number(previous.odometer)
      if (distance > 0 && Number(current.litres) > 0) {
        intervals.push({
          litresPer100Km: (Number(current.litres) / distance) * 100,
          endDate: current.date,
        })
      }
    }

    if (!intervals.length) return { vehicle, intervals, average: null, changePercent: null }
    const average = (items) => items.reduce((sum, item) => sum + item.litresPer100Km, 0) / items.length
    if (intervals.length < 3) return { vehicle, intervals, average: average(intervals), changePercent: null }
    const splitAt = Math.max(1, Math.floor(intervals.length / 2))
    const earlier = intervals.slice(0, splitAt)
    const recent = intervals.slice(splitAt)
    const earlierAverage = average(earlier)
    const recentAverage = average(recent)
    return {
      vehicle,
      intervals,
      average: average(intervals),
      changePercent: earlierAverage > 0 ? ((recentAverage - earlierAverage) / earlierAverage) * 100 : null,
    }
  }).filter((item) => item.intervals.length)
}

export function fuelCsvTemplate() {
  return 'registrationNumber,date,odometer,litres,amount,fuelStation,notes\r\n'
}
