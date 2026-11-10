const e = import.meta.env
export const env = {
  api: (e.VITE_API_BASE_URL as string | undefined) ?? '',
  ws: (e.VITE_WS_BASE_URL as string | undefined) ?? '',
  provider: (e.VITE_STORAGE_PROVIDER as string | undefined) ?? 'supabase',
  supabaseUrl: (e.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseKey: (e.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '',
  supabaseBucket: (e.VITE_SUPABASE_BUCKET as string | undefined) ?? 'lumon-media',
  cloudName: (e.VITE_CLOUDINARY_CLOUD_NAME as string | undefined) ?? '',
  preset: (e.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined) ?? '',
  build: __BUILD__,
}
