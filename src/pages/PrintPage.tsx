import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Printer, Shield, Lock, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type PrintJob = Tables<"print_jobs">;

const PrintPage = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<PrintJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const fetchJob = useCallback(async () => {
    if (!jobId) return;

    const { data, error } = await supabase
      .from("print_jobs")
      .select("id, file_name, printed, expires_at, otp_attempts, max_attempts, created_at")
      .eq("id", jobId)
      .single();

    if (error || !data) {
      setError("Print job not found");
    } else if (data.printed) {
      setError("This document has already been printed");
    } else if (new Date(data.expires_at) < new Date()) {
      setError("This print link has expired");
    } else if (data.otp_attempts >= data.max_attempts) {
      setError("Maximum verification attempts exceeded");
    } else {
      setJob(data as PrintJob);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Disable right-click
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  const handleVerifyOTP = async () => {
    if (otp.length !== 6) return;
    setVerifying(true);

    try {
      const { data, error } = await supabase.rpc("verify_otp", {
        job_id: jobId!,
        otp,
      });

      const result = data as any;

      if (error || !result.success) {
        toast.error(result?.error || "Verification failed");
        setOtp("");
        if (result?.error?.includes("exceeded") || result?.error?.includes("Locked")) {
          setError("Maximum verification attempts exceeded");
          setShowOtp(false);
        }
      } else {
        setVerified(true);
        setSessionId(result.session_id);
        setShowOtp(false);
        toast.success("OTP verified! You can now print.");
        fetchSecureFile(result.session_id);
      }
    } catch {
      toast.error("Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const fetchSecureFile = async (sid: string) => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/serve-document`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId, session_id: sid }),
        }
      );

      if (!response.ok) throw new Error("Failed to fetch document");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setFileUrl(url);
    } catch {
      toast.error("Failed to load document for printing");
    }
  };

  const handlePrint = async () => {
    if (!fileUrl || !sessionId) return;

    // Mark as printed
    await supabase.rpc("mark_as_printed", {
      job_id: jobId!,
      session: sessionId,
    });

    window.print();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="flex flex-col items-center py-12 gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
              <AlertTriangle className="h-7 w-7 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold">Access Denied</h2>
            <p className="text-muted-foreground text-center">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background no-select">
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2 no-print">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Shield className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">SecurePrint</h1>
          <p className="text-muted-foreground text-sm">One-time secure document printing</p>
        </div>

        {/* Document Card */}
        <Card className="shadow-lg no-print">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              {job?.file_name}
            </CardTitle>
            <CardDescription>
              This document is protected. Verify with OTP to print.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!verified ? (
              <div className="flex flex-col items-center gap-4 py-6">
                <div className="w-full h-48 rounded-xl bg-muted/50 flex items-center justify-center border border-border">
                  <div className="text-center text-muted-foreground">
                    <Lock className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Document preview hidden</p>
                    <p className="text-xs">Verify OTP to access</p>
                  </div>
                </div>
                <Button onClick={() => setShowOtp(true)} className="w-full sm:w-auto">
                  <Printer className="h-4 w-4 mr-2" />
                  Print Document
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-primary">
                  <CheckCircle className="h-4 w-4" />
                  OTP Verified — Ready to print
                </div>
                <Button onClick={handlePrint} className="w-full">
                  <Printer className="h-4 w-4 mr-2" />
                  Print Now
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Secure Print Area (hidden on screen, only visible during print) */}
        {verified && fileUrl && (
          <div ref={printRef} className="hidden print:block relative">
            {/* Watermark */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 opacity-10">
              <p className="text-6xl font-bold text-foreground rotate-[-30deg]">SECURE PRINT ONLY</p>
            </div>
            {/* Document (clear during print) */}
            <div className="relative">
              {job?.file_name?.endsWith(".pdf") ? (
                <iframe
                  src={fileUrl}
                  className="w-full h-[80vh]"
                  title="Document"
                />
              ) : (
                <img
                  src={fileUrl}
                  alt="Document"
                  className="w-full"
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* OTP Modal */}
      <Dialog open={showOtp} onOpenChange={setShowOtp}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter OTP Code</DialogTitle>
            <DialogDescription>
              Enter the 6-digit code provided by the document owner.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-6 py-4">
            <InputOTP maxLength={6} value={otp} onChange={setOtp}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            <Button
              onClick={handleVerifyOTP}
              disabled={otp.length !== 6 || verifying}
              className="w-full"
            >
              {verifying ? "Verifying..." : "Verify & Print"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PrintPage;
