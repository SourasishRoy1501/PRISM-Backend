const express = require('express')
const router = express.Router()
const Joi = require('joi')
const { supabaseAdmin } = require('../config/database')
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { maleInfertilityMapping, maleSexualDysfunctionMapping } = require("../utils/utilities")

const createPatient = async (payload) => {
  const { data, error: insertError } = await supabaseAdmin
    .from('patients')
    .insert(payload)
    .select()
  return { data, insertError }
}

const generatePatientPayload = (value) => {
  const today = new Date();
  return {
    doctor_id: value.user_id,
    condition_type: value.condition_type,
    full_name: value?.data?.demographics?.fullName,
    first_visit_date: new Date(value?.selectedDate),
    age: value?.data?.demographics?.age
  }
}

router.post('/male_infertility', async (req, res) => {
  const today = new Date();
  let patientData = null

  if(req.body.is_first_time) {
    const patientPayload = generatePatientPayload(req.body)
    const { data: patientDetails, insertError: patientError } = await createPatient(patientPayload)
    if (patientError) return res.status(500).json({ error: patientError.message })
    patientData = patientDetails[0]
  } else {
    patientData = { patient_id: req.body.patient_id }
  }

  // const { error, value } = maleInfertilitySchema.validate(req.body)
  // if (error) return res.status(400).json({ error: error.message })

  if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })

  // Persist as a followup record with type male_infertility
  const payload = {
    patient_id: patientData.patient_id,
    doctor_id: req.body.user_id,
    scheduled_date: req.body.selectedDate != '' ? new Date(req.body.selectedDate) : Date.now(),
    status: Date.now() > new Date(req.body.selectedDate) ? 'completed': 'upcoming',
    crf_data: req.body.data,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_initial: req.body.is_first_time
  }

  const { data, error: insertError } = await supabaseAdmin
    .from('followups')
    .insert(payload)
    .select()
    
  if (insertError) return res.status(500).json({ error: insertError.message })

  return res.json({ success: true, data })
})

router.patch('/edit', async (req, res) => {
  const payload = {
    crf_data: req.body?.crf_data
  }
  const {data, error} = await supabaseAdmin
    .from('followups')
    .update(payload)
    .eq('followup_id', req.body?.followupId)
    .select()

  return res.json({ success: true, data })
})


router.post('/male_sexual_dysfunction', async (req, res) => {

  const today = new Date();
  let patientData = null

  if(req.body.is_first_time) {
    const patientPayload = generatePatientPayload(req.body)
    const { data: patientDetails, insertError: patientError } = await createPatient(patientPayload)
    if (patientError) return res.status(500).json({ error: patientError.message })
    patientData = patientDetails[0]
  } else {
    patientData = { patient_id: req.body.patient_id }
  }

  if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })

  // Persist as a followup record with type male_sexual_dysfunction
  const payload = {
    patient_id: patientData.patient_id,
    doctor_id: req.body.user_id,
    scheduled_date: req.body.selectedDate != '' ? new Date(req.body.selectedDate) : Date.now(),
    status: Date.now() > new Date(req.body.selectedDate) ? 'completed': 'upcoming',
    crf_data: req.body.data,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_initial: req.body.is_first_time
  }

  const { data, error: insertError } = await supabaseAdmin
    .from('followups')
    .insert(payload)
    .select()
    
  if (insertError) return res.status(500).json({ error: insertError.message })

  return res.json({ success: true, data })
})

const upload = multer({ storage: multer.memoryStorage() });

const setNestedValue = (obj, path, value) => {
  const keys = path.split('.');
  let current = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  
  current[keys[keys.length - 1]] = value;
};

const extractFieldFromPDF = (pdfText, fieldName) => {
  // Create regex pattern to match field name and its value
  const pattern = new RegExp(`${fieldName}[:\\s]+(.*?)(?=\\n|$)`, 'i');
  const match = pdfText.match(pattern);
  if (match && match[1]) {
    return match[1].trim();
  }
  
  return null;
};

/**
 * Recursively clean all values in the CRF data object
 */
const cleanCRFData = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(item => cleanCRFData(item));
  }
  
  if (obj !== null && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      cleaned[key] = cleanCRFData(value);
    }
    return cleaned;
  }
  
  return cleanValue(obj);
};

/**
 * Clean and format extracted value
 */
const cleanValue = (value) => {
  if (!value) return '';
  if (typeof value !== 'string') return value;
  
  // Check if it's a checkbox field
  const cleaned = extractSelectedCheckbox(value);
  
  // Remove common form artifacts
  return cleaned
    .replace(/_{3,}/g, '') // Remove underscores (blank fields)
    .replace(/→/g, '') // Remove arrows
    .replace(/—/g, '-') // Replace em dash
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
};

/**
 * Clean checkbox string and extract selected value
 * Handles patterns like: "☐ Option1 ☐ Option2 ☑ Option3" or "☐ Yes ☐ No"
 */
const extractSelectedCheckbox = (value) => {
  if (!value || typeof value !== 'string') return '';
  
  // Check if this is a checkbox pattern
  const hasCheckboxes = value.includes('☐') || value.includes('☑') || value.includes('□') || value.includes('■');
  
  if (!hasCheckboxes) return value.trim();
  
  // Pattern 1: Look for checked boxes (☑ or ■)
  const checkedPattern = /[☑■]\s*([^☐☑□■]+)/g;
  const checkedMatches = [...value.matchAll(checkedPattern)];
  
  if (checkedMatches.length > 0) {
    return checkedMatches.map(match => match[1].trim()).join(', ');
  }
  
  // Pattern 2: No checked boxes found, return empty string
  return '';
};

router.post("/pdf", upload.single("file"), async (req, res) => {
  try {
    const parsed = await pdfParse(req.file.buffer);
    const text = parsed.text
    console.log(text)
    const crfData = {};
    
    const reversedMapping = {};
    for (const [label, path] of Object.entries(maleInfertilityMapping)) {
      reversedMapping[label] = path;
    }
    
    // Set patient ID and scheduled date
    setNestedValue(crfData, 'patientDetails', "patientId");
    setNestedValue(crfData, 'scheduledDate', "03/27/2024");
    let crftype = false
    // Extract and map all fields from PDF
    for (const [fieldLabel, crfPath] of Object.entries(maleInfertilityMapping)) {
      // Skip special fields
      if (fieldLabel === 'Id' || fieldLabel === 'Scheduled Date') continue;

      if (fieldLabel === 'Smoking Status') crftype = true;
      
      // Extract value from PDF
      const value = extractFieldFromPDF(text, fieldLabel);
      
      if (value) {
        setNestedValue(crfData, crfPath, value);
      }
    }

    setNestedValue(crfData, 'crfType', crftype);

    // Clean all checkbox values and form artifacts
    const cleanedData = cleanCRFData(crfData);

    res.json({ data: cleanedData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router
