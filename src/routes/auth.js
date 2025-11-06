const express = require('express')
const router = express.Router()
const Joi = require('joi')
const { supabaseAdmin } = require('../config/database')

const profileSchema = Joi.object({
  user_id: Joi.string().uuid().required(),
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
})

router.post('/profile', async (req, res) => {
  const { error, value } = profileSchema.validate(req.body)
  if (error) return res.status(400).json({ error: error.message })

  if (!supabaseAdmin) return res.status(500).json({ error: 'Server not configured' })

  const { user_id, name, email } = value

  const { data, error: upsertError } = await supabaseAdmin
    .from('users')
    .upsert({ user_id, name, email, role: 'doctor' }, { onConflict: 'user_id' })
    .select()
    .single()

  if (upsertError) return res.status(500).json({ error: upsertError.message })

  return res.json({ success: true, data })
})

module.exports = router

