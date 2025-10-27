{{/*
Expand the name of the chart.
*/}}
{{- define "web-search-mcp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "web-search-mcp.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "web-search-mcp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "web-search-mcp.labels" -}}
helm.sh/chart: {{ include "web-search-mcp.chart" . }}
{{ include "web-search-mcp.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "web-search-mcp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "web-search-mcp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "web-search-mcp.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "web-search-mcp.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Generate the MCP server URL for client configuration
Uses Kubernetes internal DNS to build the URL based on service name, namespace, and port
*/}}
{{- define "web-search-mcp.mcpServerUrl" -}}
{{- if .Values.client.enabled -}}
{{- $protocol := .Values.client.server.protocol | default "http" -}}
{{- $serviceName := .Values.client.server.serviceName | required "client.server.serviceName is required when client is enabled" -}}
{{- $port := .Values.client.server.port | default 3000 -}}
{{- if .Values.client.server.namespace -}}
{{- printf "%s://%s.%s.svc.cluster.local:%d" $protocol $serviceName .Values.client.server.namespace (int $port) -}}
{{- else -}}
{{- printf "%s://%s:%d" $protocol $serviceName (int $port) -}}
{{- end -}}
{{- end -}}
{{- end }}
