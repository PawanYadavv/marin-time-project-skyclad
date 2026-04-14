export interface ExtractionDetection {
  documentType: string;
  documentName: string;
  category: string;
  applicableRole: 'DECK' | 'ENGINE' | 'BOTH' | 'N/A';
  isRequired: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  detectionReason: string;
}

export interface ExtractionHolder {
  fullName: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  passportNumber: string | null;
  sirbNumber: string | null;
  rank: string | null;
  photo: 'PRESENT' | 'ABSENT';
}

export interface ExtractionField {
  key: string;
  label: string;
  value: string;
  importance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'OK' | 'EXPIRED' | 'WARNING' | 'MISSING' | 'N/A';
}

export interface ExtractionValidity {
  dateOfIssue: string | null;
  dateOfExpiry: string | null;
  isExpired: boolean;
  daysUntilExpiry: number | null;
  revalidationRequired: boolean | null;
}

export interface ExtractionCompliance {
  issuingAuthority: string;
  regulationReference: string | null;
  imoModelCourse: string | null;
  recognizedAuthority: boolean;
  limitations: string | null;
}

export interface ExtractionMedicalData {
  fitnessResult: 'FIT' | 'UNFIT' | 'N/A';
  drugTestResult: 'NEGATIVE' | 'POSITIVE' | 'N/A';
  restrictions: string | null;
  specialNotes: string | null;
  expiryDate: string | null;
}

export interface ExtractionFlag {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
}

export interface LLMExtractionResult {
  detection: ExtractionDetection;
  holder: ExtractionHolder;
  fields: ExtractionField[];
  validity: ExtractionValidity;
  compliance: ExtractionCompliance;
  medicalData: ExtractionMedicalData;
  flags: ExtractionFlag[];
  summary: string;
}

export interface ExtractionRecord {
  id: string;
  sessionId: string;
  fileName: string;
  fileHash: string;
  mimeType: string;
  documentType: string | null;
  documentName: string | null;
  category: string | null;
  applicableRole: string | null;
  confidence: string | null;
  holderName: string | null;
  dateOfBirth: string | null;
  sirbNumber: string | null;
  passportNumber: string | null;
  fieldsJson: string | null;
  validityJson: string | null;
  complianceJson: string | null;
  medicalDataJson: string | null;
  flagsJson: string | null;
  isExpired: boolean;
  summary: string | null;
  rawLlmResponse: string | null;
  processingTimeMs: number | null;
  status: 'PENDING' | 'COMPLETE' | 'FAILED';
  errorCode: string | null;
  errorMessage: string | null;
  promptVersion: string | null;
  createdAt: string;
}

export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETE' | 'FAILED';

export interface JobRecord {
  id: string;
  sessionId: string;
  extractionId: string;
  fileBuffer: Buffer | null;
  fileName: string | null;
  mimeType: string | null;
  status: JobStatus;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SessionRecord {
  id: string;
  createdAt: string;
}

export interface ValidationRecord {
  id: string;
  sessionId: string;
  resultJson: string;
  createdAt: string;
}

export interface ValidationResult {
  sessionId: string;
  holderProfile: {
    name: string | null;
    dateOfBirth: string | null;
    nationality: string | null;
    rank: string | null;
    detectedRole: string;
    sirbNumber: string | null;
    passportNumber: string | null;
  };
  consistencyChecks: Array<{
    field: string;
    status: 'CONSISTENT' | 'INCONSISTENT' | 'MISSING';
    details: string;
    documents: string[];
  }>;
  missingDocuments: Array<{
    documentType: string;
    documentName: string;
    importance: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
    reason: string;
  }>;
  expiringDocuments: Array<{
    documentType: string;
    fileName: string;
    expiryDate: string;
    daysUntilExpiry: number;
    urgency: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'OK';
  }>;
  medicalFlags: Array<{
    type: string;
    status: string;
    details: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
  overallStatus: 'APPROVED' | 'CONDITIONAL' | 'REJECTED';
  overallScore: number;
  summary: string;
  recommendations: string[];
  validatedAt: string;
}

export interface ApiError {
  error: string;
  message: string;
  extractionId?: string;
  retryAfterMs?: number | null;
}

export type OverallHealth = 'OK' | 'WARN' | 'CRITICAL';
