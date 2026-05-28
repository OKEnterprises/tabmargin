export type Bindings = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_ID: string
  STRIPE_WEBHOOK_SECRET: string
  BILLING_RETURN_URL: string
  ALLOWED_ORIGINS?: string
}

export type SubRow = {
  status: string
  current_period_end: string | null
}
