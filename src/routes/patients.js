const express = require('express')
const router = express.Router()

const { supabaseAdmin } = require('../config/database')

// GET /api/patients
// Query params: doctor_id (required), q, condition, first_visit_from, first_visit_to, last_visit_from, last_visit_to, page, page_size
router.get('/', async (req, res) => {
  try {
    const {
      doctor_id: doctorId,
      q,
      condition,
      first_visit_from: firstVisitFrom,
      first_visit_to: firstVisitTo,
      last_visit_from: lastVisitFrom,
      last_visit_to: lastVisitTo,
      page = '1',
      page_size = '10',
    } = req.query

    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })
    if (!doctorId) return res.status(400).json({ error: 'doctor_id is required' })

    const pageNum = Math.max(parseInt(page, 10) || 1, 1)
    const pageSizeNum = Math.min(Math.max(parseInt(page_size, 10) || 10, 1), 100)
    const from = (pageNum - 1) * pageSizeNum
    const to = from + pageSizeNum - 1

    // Base query
    let query = supabaseAdmin
      .from('patients')
      .select('*', { count: 'exact' })
      .eq('doctor_id', doctorId)

    if (condition) {
      query = query.eq('condition_type', condition)
    }
    if (firstVisitFrom) {
      query = query.gte('first_visit_date', firstVisitFrom)
    }
    if (firstVisitTo) {
      query = query.lte('first_visit_date', firstVisitTo)
    }

    // For name search inside JSON, we filter client-side after fetch window page.
    // To improve UX, if q looks like a UUID fragment or id, let DB prefilter on patient_id.
    if (q && q.length >= 3) {
      query = query.or(`patient_id.ilike.%${q}%,full_name.ilike.%${q}%`)
    }

    // Pagination
    query = query.order('updated_at', { ascending: false }).range(from, to)

    const { data: patients, error, count } = await query
    if (error) return res.status(500).json({ error: error.message })

    const patientIds = (patients || []).map((p) => p.patient_id)
    let lastVisitMap = {}
    if (patientIds.length) {
      const { data: meetups, error: meetupsError } = await supabaseAdmin
        .from('followups')
        .select('patient_id, scheduled_date, status')
        .in('patient_id', patientIds)
      if (meetupsError) {
        return res.status(500).json({ error: meetupsError.message })
      }
      for (const m of meetups) {
        const key = m.patient_id
        const d = m.scheduled_date
        const status = m.status
        if(status === "completed") {
          if (!lastVisitMap[key] || new Date(d) > new Date(lastVisitMap[key])) {
            lastVisitMap[key] = d
          }
        }
      }
    }

    // Optional last visit range filtering (server-side after aggregation)
    const filteredPatients = patients.filter((p) => {
      const lastVisit = lastVisitMap[p.patient_id] || null
      if (lastVisitFrom && (!lastVisit || new Date(lastVisit) < new Date(lastVisitFrom))) return false
      if (lastVisitTo && (!lastVisit || new Date(lastVisit) > new Date(lastVisitTo))) return false
      return true
    })

    // Compose items
    const items = filteredPatients.map((p) => ({
      patient_id: p.patient_id,
      doctor_id: p.doctor_id,
      condition_type: p.condition_type,
      first_visit_date: p.first_visit_date,
      last_visit_date: lastVisitMap[p.patient_id] || null,
      full_name: p.full_name,
      created_at: p.created_at,
      updated_at: p.updated_at,
      age: p.age
    }))

    return res.json({
      items,
      page: pageNum,
      page_size: pageSizeNum,
      total: count || 0,
    })
  } catch (err) {
    console.error('GET /api/patients error', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/', async (req, res) => {
  const { patientId } = req?.body
  if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })
  if (!patientId) return res.status(500).json({ error: 'Patient id is incorrect' })
  const {data, error} = await supabaseAdmin
      .from('patients')
      .delete()
      .eq("patient_id", patientId)
  if(error) return res.status(500).json({ error: error.message })
  
  const { followupData, followupError } = await supabaseAdmin
      .from("followups")
      .delete()
      .eq("patient_id", patientId)
  if(followupError) return res.status(500).json({ error: error.message })
     
  return res.status(200).json(data)
})

// GET /api/patients/:patient_id - fetch a single patient summary
router.get('/:patient_id', async (req, res) => {
  try {
    const { patient_id: patientId } = req.params
    const { doctor_id: doctorId } = req.query

    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })
    if (!doctorId) return res.status(400).json({ error: 'doctor_id is required' })
    if (!patientId) return res.status(400).json({ error: 'patient_id is required' })

    const { data: patient, error } = await supabaseAdmin
      .from('patients')
      .select('*')
      .eq('doctor_id', doctorId)
      .eq('patient_id', patientId)
      .single()

    if (error) return res.status(404).json({ error: error.message })

    // last completed visit
    const { data: meetups, error: meetupsError } = await supabaseAdmin
      .from('followups')
      .select('scheduled_date, status')
      .eq('patient_id', patientId)

    if (meetupsError) return res.status(500).json({ error: meetupsError.message })

    let lastVisit = null
    for (const m of meetups || []) {
      if (m.status === 'completed') {
        if (!lastVisit || new Date(m.scheduled_date) > new Date(lastVisit)) {
          lastVisit = m.scheduled_date
        }
      }
    }

    return res.json({
      patient_id: patient.patient_id,
      doctor_id: patient.doctor_id,
      condition_type: patient.condition_type,
      first_visit_date: patient.first_visit_date,
      last_visit_date: lastVisit,
      full_name: patient.full_name,
      created_at: patient.created_at,
      updated_at: patient.updated_at,
      age: patient.age,
    })
  } catch (err) {
    console.error('GET /api/patients/:patient_id error', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/patients/:patient_id/followups - list followups for a patient (timeline)
router.get('/:patient_id/followups', async (req, res) => {
  try {
    const { patient_id: patientId } = req.params
    const { doctor_id: doctorId } = req.query

    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })
    if (!doctorId) return res.status(400).json({ error: 'doctor_id is required' })
    if (!patientId) return res.status(400).json({ error: 'patient_id is required' })

    const { data, error } = await supabaseAdmin
      .from('followups')
      .select('followup_id, scheduled_date, status, is_initial, created_at, crf_data')
      .eq('patient_id', patientId)
      .eq('doctor_id', doctorId)
      .order('scheduled_date', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })

    const items = (data || []).map((f, idx) => ({
      id: f.followup_id,
      date: f.scheduled_date,
      title: f.is_initial ? 'Initial Consultation' : `Follow-up ${data.length - idx}`,
      status: f.status,
      is_initial: f.is_initial,
      crf_data: f.crf_data,
    }))

    return res.json({ items })
  } catch (err) {
    console.error('GET /api/patients/:patient_id/followups error', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/patients/:patient_id/followups/:followup_id - fetch CRF details for a followup
router.get('/:patient_id/followups/:followup_id', async (req, res) => {
  try {
    const { patient_id: patientId, followup_id: followupId } = req.params
    const { doctor_id: doctorId } = req.query

    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })
    if (!doctorId) return res.status(400).json({ error: 'doctor_id is required' })

    const { data, error } = await supabaseAdmin
      .from('followups')
      .select('followup_id, patient_id, doctor_id, scheduled_date, status, crf_data, is_initial, created_at, updated_at')
      .eq('followup_id', followupId)
      .eq('patient_id', patientId)
      .eq('doctor_id', doctorId)
      .single()

    if (error) return res.status(404).json({ error: error.message })

    return res.json({ item: data })
  } catch (err) {
    console.error('GET /api/patients/:patient_id/followups/:followup_id error', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router


