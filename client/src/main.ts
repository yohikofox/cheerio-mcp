import './style.css'
import { MCPWebClient } from './mcp-client'
import type { MCPTool } from './mcp-client'

const app = document.querySelector<HTMLDivElement>('#app')!

let mcpClient: MCPWebClient;
let tools: MCPTool[] = [];

// Initialize the app
async function init() {
  renderLoading();

  try {
    mcpClient = new MCPWebClient();
    await mcpClient.connect();

    tools = await mcpClient.listTools();

    renderUI();
  } catch (error) {
    renderError(error as Error);
  }
}

function renderLoading() {
  app.innerHTML = `
    <div class="container">
      <header>
        <h1>MCP Web Client</h1>
        <p>Connecting to Model Context Protocol server...</p>
      </header>
      <div class="loading">
        <div class="spinner"></div>
      </div>
    </div>
  `;
}

function renderError(error: Error) {
  app.innerHTML = `
    <div class="container">
      <header>
        <h1>MCP Web Client</h1>
        <p>Connection Error</p>
      </header>
      <div class="error">
        <h3>Failed to connect to MCP server</h3>
        <p>${error.message}</p>
        <button onclick="location.reload()">Retry</button>
      </div>
    </div>
  `;
}

function renderUI() {
  app.innerHTML = `
    <div class="container">
      <header>
        <h1>MCP Web Client</h1>
        <p>Model Context Protocol - Dynamic Tool Discovery</p>
      </header>

      <div class="status-bar">
        <div class="status-indicator">
          <div class="status-dot connected"></div>
          <span>Connected</span>
        </div>
        <div class="info">
          ${tools.length} tools available
        </div>
      </div>

      <div class="tabs" id="tabs"></div>
      <div class="content" id="content"></div>
    </div>
  `;

  renderTabs();
  renderToolPanels();

  // Activate first tab
  if (tools.length > 0) {
    activateTab(0);
  }
}

function renderTabs() {
  const tabsContainer = document.getElementById('tabs')!;

  tabsContainer.innerHTML = tools.map((tool, index) => `
    <button class="tab" data-index="${index}">
      ${formatToolName(tool.name)}
    </button>
  `).join('');

  // Add click handlers
  tabsContainer.querySelectorAll('.tab').forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(index));
  });
}

function renderToolPanels() {
  const contentContainer = document.getElementById('content')!;

  contentContainer.innerHTML = tools.map((tool, index) => `
    <div class="tool-panel" data-index="${index}">
      <div class="tool-description">
        <p>${tool.description}</p>
      </div>
      <form id="form-${tool.name}">
        ${renderFormFields(tool)}
        <button type="submit">Execute Tool</button>
      </form>
      <div id="result-${tool.name}" class="result-container"></div>
    </div>
  `).join('');

  // Add form handlers
  tools.forEach(tool => {
    const form = document.getElementById(`form-${tool.name}`);
    if (form) {
      form.addEventListener('submit', (e) => handleToolSubmit(e, tool));
    }
  });
}

function renderFormFields(tool: MCPTool): string {
  const schema = tool.inputSchema;
  const properties = schema.properties || {};
  const required = schema.required || [];

  return Object.entries(properties).map(([name, propSchema]) => {
    const isRequired = required.includes(name);
    return renderFormField(name, propSchema, isRequired);
  }).join('');
}

function renderFormField(name: string, schema: any, required: boolean): string {
  const label = schema.description || name;
  const id = `input-${name}`;

  if (schema.type === 'string' && schema.enum) {
    return `
      <div class="form-group">
        <label for="${id}">${label}${required ? ' *' : ''}</label>
        <select id="${id}" name="${name}" ${required ? 'required' : ''}>
          ${schema.enum.map((val: string) => `<option value="${val}">${val}</option>`).join('')}
        </select>
      </div>
    `;
  } else if (schema.type === 'array') {
    const defaultValue = schema.default ? schema.default.join('\n') : '';
    return `
      <div class="form-group">
        <label for="${id}">${label}${required ? ' *' : ''}</label>
        <textarea id="${id}" name="${name}" ${required ? 'required' : ''} placeholder="${schema.description || ''}">${defaultValue}</textarea>
        <small>One item per line</small>
      </div>
    `;
  } else if (schema.type === 'number') {
    return `
      <div class="form-group">
        <label for="${id}">${label}${required ? ' *' : ''}</label>
        <input type="number" id="${id}" name="${name}" ${required ? 'required' : ''}
          ${schema.minimum !== undefined ? `min="${schema.minimum}"` : ''}
          ${schema.maximum !== undefined ? `max="${schema.maximum}"` : ''}
          value="${schema.default || ''}">
      </div>
    `;
  } else if (schema.type === 'boolean') {
    return `
      <div class="form-group">
        <label>
          <input type="checkbox" id="${id}" name="${name}" ${schema.default ? 'checked' : ''}>
          ${label}
        </label>
      </div>
    `;
  } else {
    return `
      <div class="form-group">
        <label for="${id}">${label}${required ? ' *' : ''}</label>
        <input type="text" id="${id}" name="${name}" ${required ? 'required' : ''} placeholder="${schema.description || ''}">
      </div>
    `;
  }
}

async function handleToolSubmit(event: Event, tool: MCPTool) {
  event.preventDefault();

  const form = event.target as HTMLFormElement;
  const formData = new FormData(form);
  const args: Record<string, any> = {};

  // Build arguments from form data
  for (const [name, propSchema] of Object.entries(tool.inputSchema.properties || {})) {
    const value = formData.get(name);

    if (propSchema.type === 'array') {
      const arrayValue = value ? (value as string).split('\n').filter(v => v.trim()) : [];
      args[name] = arrayValue.length > 0 ? arrayValue : (propSchema.default || []);
    } else if (propSchema.type === 'number') {
      args[name] = value ? parseFloat(value as string) : propSchema.default;
    } else if (propSchema.type === 'boolean') {
      args[name] = (form.elements.namedItem(name) as HTMLInputElement).checked;
    } else if (value) {
      args[name] = value;
    } else if (propSchema.default !== undefined) {
      args[name] = propSchema.default;
    }
  }

  const resultContainer = document.getElementById(`result-${tool.name}`)!;
  resultContainer.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const result = await mcpClient.callTool(tool.name, args);

    const content = result.content[0];
    const text = content.type === 'text' ? content.text : JSON.stringify(content, null, 2);

    resultContainer.innerHTML = `
      <h3>Result</h3>
      <pre>${text}</pre>
    `;
  } catch (error) {
    resultContainer.innerHTML = `
      <div class="error">
        <h3>Error</h3>
        <p>${(error as Error).message}</p>
      </div>
    `;
  }
}

function activateTab(index: number) {
  // Update tabs
  document.querySelectorAll('.tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === index);
  });

  // Update panels
  document.querySelectorAll('.tool-panel').forEach((panel, i) => {
    (panel as HTMLElement).style.display = i === index ? 'block' : 'none';
  });
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Initialize on load
init();

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  if (mcpClient) {
    mcpClient.disconnect();
  }
});
