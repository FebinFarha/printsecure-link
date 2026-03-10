
-- Create print_jobs table
CREATE TABLE public.print_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  placeholder_path TEXT,
  otp_code TEXT NOT NULL,
  otp_attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '30 minutes'),
  printed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;

-- Owner can do everything with their own jobs
CREATE POLICY "Owners can view their own jobs"
  ON public.print_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Owners can insert their own jobs"
  ON public.print_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners can update their own jobs"
  ON public.print_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Owners can delete their own jobs"
  ON public.print_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Anon/shopkeeper can read basic job info for print page
CREATE POLICY "Anyone can view jobs by id"
  ON public.print_jobs FOR SELECT TO anon
  USING (true);

-- Create function to verify OTP
CREATE OR REPLACE FUNCTION public.verify_otp(job_id UUID, otp TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job RECORD;
BEGIN
  SELECT * INTO job FROM public.print_jobs WHERE id = job_id;
  
  IF job IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job not found');
  END IF;
  
  IF job.printed THEN
    RETURN jsonb_build_object('success', false, 'error', 'Document already printed');
  END IF;
  
  IF job.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Print link has expired');
  END IF;
  
  IF job.otp_attempts >= job.max_attempts THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum OTP attempts exceeded');
  END IF;
  
  IF job.otp_code != otp THEN
    UPDATE public.print_jobs SET otp_attempts = otp_attempts + 1 WHERE id = job_id;
    RETURN jsonb_build_object('success', false, 'error', 'Invalid OTP code', 'attempts_remaining', job.max_attempts - job.otp_attempts - 1);
  END IF;
  
  UPDATE public.print_jobs SET session_id = gen_random_uuid()::text WHERE id = job_id;
  SELECT * INTO job FROM public.print_jobs WHERE id = job_id;
  
  RETURN jsonb_build_object('success', true, 'session_id', job.session_id);
END;
$$;

-- Create function to mark as printed
CREATE OR REPLACE FUNCTION public.mark_as_printed(job_id UUID, session TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job RECORD;
BEGIN
  SELECT * INTO job FROM public.print_jobs WHERE id = job_id AND session_id = session;
  
  IF job IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid session');
  END IF;
  
  UPDATE public.print_jobs SET printed = true WHERE id = job_id;
  
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('placeholders', 'placeholders', true);

-- Storage policies for documents (private)
CREATE POLICY "Users can upload their own documents"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own documents"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for placeholders (public read)
CREATE POLICY "Anyone can view placeholders"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'placeholders');

CREATE POLICY "Users can upload placeholders"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'placeholders' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete placeholders"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'placeholders' AND auth.uid()::text = (storage.foldername(name))[1]);
