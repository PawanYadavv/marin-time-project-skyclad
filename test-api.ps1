# ============================================
#  SMDE API Test Script
#  Run this to test all endpoints
# ============================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SMDE Backend API - Test Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------------------
# TEST 1: Health Check
# -------------------------------------------
Write-Host "[TEST 1] Health Check" -ForegroundColor Yellow
Write-Host "  Calling: GET http://localhost:3000/api/health"
Write-Host ""

try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health"
    Write-Host "  Status: $($health.status)" -ForegroundColor Green
    Write-Host "  Database: $($health.dependencies.database)"
    Write-Host "  LLM: $($health.dependencies.llmProvider)"
    Write-Host "  Queue: $($health.dependencies.queue)"
} catch {
    Write-Host "  FAILED - Is the server running? Run 'npm run dev' first!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------------------
# TEST 2: Upload a document (Sync mode)
# -------------------------------------------
Write-Host "[TEST 2] Upload Document (Sync Mode)" -ForegroundColor Yellow

# Check if user provided a file
$testFile = $args[0]

if (-not $testFile) {
    Write-Host ""
    Write-Host "  To test document extraction, run this script with a file:" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "    .\test-api.ps1 C:\path\to\your\document.jpg" -ForegroundColor White
    Write-Host ""
    Write-Host "  You can use ANY image - a photo of an ID card, certificate," -ForegroundColor Magenta
    Write-Host "  passport, medical report, or even a screenshot." -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  Supported formats: .jpg, .jpeg, .png, .pdf" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  Skipping upload tests..." -ForegroundColor DarkGray
    exit 0
}

if (-not (Test-Path $testFile)) {
    Write-Host "  File not found: $testFile" -ForegroundColor Red
    exit 1
}

Write-Host "  Uploading: $testFile"
Write-Host "  This calls the AI to read your document. May take 5-15 seconds..."
Write-Host ""

try {
    # Build multipart form data
    $fileName = Split-Path $testFile -Leaf
    $fileBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $testFile))
    
    $boundary = [System.Guid]::NewGuid().ToString()
    
    # Determine content type
    $ext = [System.IO.Path]::GetExtension($testFile).ToLower()
    $contentType = switch ($ext) {
        ".jpg"  { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        ".png"  { "image/png" }
        ".pdf"  { "application/pdf" }
        default { "application/octet-stream" }
    }
    
    # Create multipart body
    $LF = "`r`n"
    $bodyLines = @(
        "--$boundary",
        "Content-Disposition: form-data; name=`"document`"; filename=`"$fileName`"",
        "Content-Type: $contentType",
        "",
        ""
    ) -join $LF
    
    $bodyEnd = "$LF--$boundary--$LF"
    
    $bodyStart = [System.Text.Encoding]::UTF8.GetBytes($bodyLines)
    $bodyEndBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyEnd)
    
    $body = New-Object byte[] ($bodyStart.Length + $fileBytes.Length + $bodyEndBytes.Length)
    [System.Buffer]::BlockCopy($bodyStart, 0, $body, 0, $bodyStart.Length)
    [System.Buffer]::BlockCopy($fileBytes, 0, $body, $bodyStart.Length, $fileBytes.Length)
    [System.Buffer]::BlockCopy($bodyEndBytes, 0, $body, $bodyStart.Length + $fileBytes.Length, $bodyEndBytes.Length)
    
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/extract?mode=sync" `
        -Method POST `
        -ContentType "multipart/form-data; boundary=$boundary" `
        -Body $body
    
    Write-Host "  SUCCESS!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  --- Extraction Result ---" -ForegroundColor Cyan
    Write-Host "  Document Type : $($response.documentType)"
    Write-Host "  Document Name : $($response.documentName)"
    Write-Host "  Holder Name   : $($response.holderName)"
    Write-Host "  Role          : $($response.applicableRole)"
    Write-Host "  Confidence    : $($response.confidence)"
    Write-Host "  Is Expired    : $($response.isExpired)"
    Write-Host "  Session ID    : $($response.sessionId)"
    Write-Host "  Extraction ID : $($response.id)"
    Write-Host ""
    Write-Host "  Summary: $($response.summary)"
    Write-Host ""
    
    $sessionId = $response.sessionId
    
    # -------------------------------------------
    # TEST 3: Get Session
    # -------------------------------------------
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[TEST 3] Get Session Details" -ForegroundColor Yellow
    Write-Host "  Calling: GET http://localhost:3000/api/sessions/$sessionId"
    Write-Host ""
    
    $session = Invoke-RestMethod -Uri "http://localhost:3000/api/sessions/$sessionId"
    Write-Host "  Document Count : $($session.documentCount)"
    Write-Host "  Detected Role  : $($session.detectedRole)"
    Write-Host "  Overall Health : $($session.overallHealth)"
    Write-Host ""
    
    # -------------------------------------------
    # TEST 4: Get Report
    # -------------------------------------------
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[TEST 4] Get Compliance Report" -ForegroundColor Yellow
    Write-Host "  Calling: GET http://localhost:3000/api/sessions/$sessionId/report"
    Write-Host ""
    
    $report = Invoke-RestMethod -Uri "http://localhost:3000/api/sessions/$sessionId/report"
    Write-Host "  Report ID      : $($report.reportId)"
    Write-Host "  Seafarer Name  : $($report.seafarerProfile.name)"
    Write-Host "  Total Documents: $($report.portfolioOverview.totalDocuments)"
    Write-Host "  Decision       : $($report.decision.recommendation)" -ForegroundColor Yellow
    Write-Host ""
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  All tests passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Full JSON response saved to: test-output.json" -ForegroundColor DarkGray
    $response | ConvertTo-Json -Depth 10 | Set-Content "test-output.json"
    
} catch {
    Write-Host "  FAILED!" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        Write-Host "  Response: $errorBody" -ForegroundColor DarkGray
    }
}
