const express = require('express')
const router = express.Router()


const { supabaseAdmin } = require('../config/database')

const createPatient = async (payload) => {
    const { data, error: insertError } = await supabaseAdmin
      .from('patients')
      .insert(payload)
      .select()
    return { data, insertError }
}

// GET /api/doctor
// Query params: doctor_id (required), q, condition, first_visit_from, first_visit_to, last_visit_from, last_visit_to, page, page_size
router.get('/appointments', async (req, res) => {
    const { doctor_id, year, month, count } = req.query
    let patientDetails = [];
    const response = {};

    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })
    if (!doctor_id) return res.status(400).json({ error: 'doctor_id is required' })

    const lastDay = {
        1: '31', 2: '28', 3: '31', 4: '30', 5: '31', 6: '30', 7: '31', 8: '31', 9: '30', 10: '31', 11: '30', 12: '31'
    }

    const firstDayofMonth = year + '-' + month + '-01';
    const lastDayofMonth = year + '-' + month + '-' + lastDay[month];

    let query = supabaseAdmin
        .from('followups')
        .select('patient_id, scheduled_date, status, followup_id', { count: 'exact' })
        .eq('doctor_id', doctor_id)
        .gte('scheduled_date', firstDayofMonth)
        .lte('scheduled_date', lastDayofMonth)

    const { data: followups, error } = await query
    if (error) return res.status(500).json({ error: error.message })

    if (!count) {
        const patients = new Set();
        followups.forEach((followup) => {
            if (!patients.has(followup?.patient_id)) {
                patients.add(followup?.patient_id);
            }
        });
        const { data, error } = await supabaseAdmin
            .from('patients')
            .select('*')
            .in('patient_id', [...patients])
        if (error) return res.status(500).json({ error: error.message })
        patientDetails = data;
    }

    for (let i = 1; i <= 31; i++) {
        const filteredFollowup = followups.filter((followup) => followup.scheduled_date == (year + '-' + month + '-' + (i < 10 ? ('0' + i) : i)))

        const filteredPatientDetails = filteredFollowup.map((followup) => {
            const patientDetail =  patientDetails.filter((patientDetail) => followup.patient_id === patientDetail.patient_id)
            return patientDetail.map((d) => {
                return {followupId: followup?.followup_id, ...d}
            })
        })
        response[i] = {
            count: filteredFollowup.length,
            status: filteredFollowup.length > 5 ? 'busy' : (filteredFollowup.length > 2 ? 'moderate' : 'available'),
            patientDetails: [...filteredPatientDetails]
        }
    }

    return res.json({
        response,
        doctor_id
    })
})

router.get('/getRecentAppointments', async (req, res) => {

    const firstDay = req.query?.firstDay;
    const lastDayDate = new Date(firstDay);
    lastDayDate.setDate(lastDayDate.getDate() + 4);

    const lastDay = lastDayDate.toISOString().split('T')[0];

    const {data: recentAppointmentsData, error} = await supabaseAdmin
        .from('followups')
        .select(`
            patient_id,
            scheduled_date,
            status,
            followup_id,
            patients ( full_name, condition_type )
        `, { count: 'exact' })
        .eq('doctor_id', req.query?.doctor_id)
        .gte('scheduled_date', firstDay)
        .order('scheduled_date', { ascending: true }) // sort ascending
        .limit(5); // only top 5
    
    const { data: patientData, error: patientError } = await supabaseAdmin
    .from('patients')
    .select('condition_type', { count: 'exact' })
    .eq('doctor_id', req.query?.doctor_id);
    
    const totalCount = patientData.length;
    const infertilityCount = patientData.filter(p => p.condition_type === 'male_infertility').length;
    const dysfunctionCount = patientData.filter(p => p.condition_type === 'male_sexual_dysfunction').length;

    const { data, error: countError } = await supabaseAdmin
        .from('followups')
        .select('scheduled_date, followup_id', { count: 'exact' })
        .eq('doctor_id', req.query?.doctor_id)
        .gte('scheduled_date', firstDay)
        .lte('scheduled_date', lastDay)
    
    
    const countData = data?.reduce((acc, row) => {
        acc[row.scheduled_date] = (acc[row.scheduled_date] || 0) + 1;
        return acc;
        }, {});

    
    const {count: appointmentCount} = await supabaseAdmin
        .from('followups')
        .select('*', { count: 'exact', head: true })
        .eq('doctor_id', req.query?.doctor_id)
        .gte('scheduled_date', firstDay)
    
    
    if (patientError || error || countError) return res.status(500).json({ error: error.message })

    return res.json({
        recentAppointmentsData,
        totalCount,
        infertilityCount,
        dysfunctionCount,
        appointmentCount,
        countData,
        nextDaysCount: data?.length
    })
})

router.post('/scheduleAppointment', async (req, res) => {
    let patientData = null;
    console.log(req.body)
    if (req.body?.addPatient) {
        const patientPayload = {
            doctor_id: req.body?.user_id,
            condition_type: req.body?.condition_type,
            full_name: req.body?.fullName,
            first_visit_date: new Date(req.body?.selectedDate),
            age: req.body?.age
        }
        console.log('patient', patientPayload)
        const { data: patientDetails, insertError: patientError } = await createPatient(patientPayload)
        if (patientError) return res.status(500).json({ error: patientError.message })
        patientData = patientDetails[0]
    }

    const payload = {
        patient_id: patientData?.patient_id || req.body?.patient_id,
        doctor_id: req.body.user_id,
        scheduled_date: req.body.selectedDate != '' ? new Date(req.body.selectedDate) : Date.now(),
        status: Date.now() > new Date(req.body.selectedDate) ? 'completed' : 'upcoming',
        crf_data: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_initial: req.body?.addPatient
    }
    console.log('followup', payload)
    const { data, error: insertError } = await supabaseAdmin
        .from('followups')
        .insert(payload)
        .select()

    if (insertError) return res.status(500).json({ error: insertError.message })

    return res.json({ success: true, data })
})

router.delete('/deleteAppointment', async (req, res) => {
    const { followupId } = req.body

    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })
    if(!followupId) return res.status(400).json({ error: 'followupId is required' })
    
    const { data , error } = await supabaseAdmin
        .from("followups")
        .delete()
        .eq("followup_id", followupId)
    
    console.log(data)

    if(error) return res.status(400).json({ error: error.message })
    
    return res.status(200).json(data)
})

router.patch('/rescheduleAppointment', async (req, res) => {
    const { followupId , newScheduledDate } = req.body
    console.log(followupId, newScheduledDate)

    if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })
    if(!followupId) return res.status(400).json({ error: 'followupId is required' })

    const payload = {
        "scheduled_date": newScheduledDate
    }
    const { data, error } = await supabaseAdmin
        .from("followups")
        .update(payload)
        .eq("followup_id", followupId)
        .select()
    
    if(error) res.status(400).json({ error: error.message })

    return res.status(200).json(data)
})

module.exports = router
