// DOM Elements
const chatWindow = document.querySelector(".chat-window");
const chatInput = document.querySelector(".chat-window input[type='text']");
const sendButton = document.querySelector(".chat-window .send-btn");
const uploadButton = document.querySelector(".chat-window .upload-btn");
const fileInput = document.querySelector(".chat-window .file-input");
const chatContainer = document.querySelector(".chat-window .chat");

function hideandshow(){
  chatWindow.classList.toggle("hide");
}

// Track uploaded file
let uploadedFile = null;

// Track session for appointment booking
let sessionId = null;

// Generate session ID
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Initialize session
function initializeSession() {
  if (!sessionId) {
    sessionId = generateSessionId();
    console.log('Generated session ID:', sessionId);
  }
}

// Function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Function to add message to chat
function addMessage(sender, message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = sender; // 'user' or 'model'
  
  // Format message to preserve line breaks
  const formattedMessage = message.replace(/\n/g, '<br>');
  messageDiv.innerHTML = `<p>${formattedMessage}</p>`;
  
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  
  if (sender === 'user') {
    chatInput.value = "";
  }
}

// Function to show file status
function showFileStatus(message, isSuccess = true) {
  // Remove any existing file status
  const existingStatus = document.querySelector('.file-status');
  if (existingStatus) {
    existingStatus.remove();
  }
  
  // Create new status message
  const statusDiv = document.createElement('div');
  statusDiv.className = 'file-status';
  statusDiv.style.cssText = `
    padding: 8px 16px;
    margin: 0 8px 8px 8px;
    border-radius: 10px;
    font-size: 14px;
    font-family: "Inter", sans-serif;
    background-color: ${isSuccess ? '#d4edda' : '#f8d7da'};
    color: ${isSuccess ? '#155724' : '#721c24'};
    border: 1px solid ${isSuccess ? '#c3e6cb' : '#f5c6cb'};
  `;
  statusDiv.textContent = message;
  
  // Insert before input area
  const inputArea = document.querySelector('.input-area');
  inputArea.parentNode.insertBefore(statusDiv, inputArea);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (statusDiv && statusDiv.parentNode) {
      statusDiv.remove();
    }
  }, 5000);
}

// Function to handle file selection
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) {
    // Check file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB in bytes
    if (file.size > maxSize) {
      showFileStatus(`File size (${formatFileSize(file.size)}) exceeds the 10MB limit. Please choose a smaller file.`, false);
      clearUploadedFile();
      return;
    }
    
    uploadedFile = file;
    const fileSize = formatFileSize(file.size);
    
    // Show success message
    showFileStatus(`${file.name} (${fileSize}) uploaded successfully!`, true);
    
    // Change upload button to red cross
    uploadButton.innerHTML = '❌';
    uploadButton.style.backgroundColor = '#dc3545'; // Red color
    uploadButton.title = 'Remove file';
    
    console.log('File selected:', file.name, 'Size:', fileSize);
  }
}

// Function to clear uploaded file
function clearUploadedFile() {
  uploadedFile = null;
  fileInput.value = ''; // Clear file input
  
  // Reset upload button to paperclip
  uploadButton.innerHTML = '📎';
  uploadButton.style.backgroundColor = '#6c757d'; // Gray color
  uploadButton.title = 'Upload Document';
  
  // Remove file status
  const existingStatus = document.querySelector('.file-status');
  if (existingStatus) {
    existingStatus.remove();
  }
}

// Function to handle upload button click
function handleUploadButtonClick() {
  if (uploadedFile) {
    // If file is uploaded, remove it
    clearUploadedFile();
  } else {
    // If no file, open file dialog
    fileInput.click();
  }
}

// Function to detect appointment booking keywords
function isAppointmentRequest(message) {
  const appointmentKeywords = [
    'call me', 'book an appointment', 'schedule appointment', 
    'book appointment', 'appointment', 'schedule a call', 
    'schedule meeting', 'need a call', 'want to book', 
    'set up meeting', 'arrange a call'
  ];
  return appointmentKeywords.some(keyword => message.toLowerCase().includes(keyword));
}

// Main function to send message
async function sendMessage() {
  const text = chatInput.value.trim();
  if (text.length === 0 && !uploadedFile) return;
  
  // Initialize session if needed
  initializeSession();
  
  // Add user message to chat
  if (text.length > 0) {
    const displayMessage = uploadedFile ? 
      `📄 ${uploadedFile.name}: ${text}` : 
      text;
    addMessage('user', displayMessage);
  } else if (uploadedFile) {
    addMessage('user', `📄 Analyzing: ${uploadedFile.name}`);
  }
  
  // Show typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'model typing';
  typingDiv.innerHTML = '<p>Bot is typing...</p>';
  chatContainer.appendChild(typingDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  
  try {
    let response;
    
    if (uploadedFile) {
      // Send file with message
      const formData = new FormData();
      formData.append('file', uploadedFile);
      formData.append('message', text || 'Please analyze this document');
      formData.append('sessionId', sessionId);
      
      console.log('Sending file and message:', uploadedFile.name, text, 'SessionID:', sessionId);
      
      response = await fetch('/chat-with-file', {
        method: 'POST',
        body: formData
      });
    } else {
      // Send text-only message
      console.log('Sending text message:', text, 'SessionID:', sessionId);
      
      response = await fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          message: text,
          sessionId: sessionId
        })
      });
    }

    // Remove typing indicator
    typingDiv.remove();

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || 'Network error';
      } catch {
        errorMessage = 'Network error';
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log('Bot response:', data.response);
    
    // Add bot response to chat
    addMessage('model', data.response);
    
    // Clear uploaded file after sending
    if (uploadedFile) {
      clearUploadedFile();
    }
    
  } catch (error) {
    // Remove typing indicator on error
    if (typingDiv.parentNode) {
      typingDiv.remove();
    }
    
    console.log('Error:', error);
    addMessage('model', `Sorry, there was an error: ${error.message}`);
  }
}

// Function to show appointment booking help
function showAppointmentHelp() {
  const helpMessage = `
🤖 I can help you book appointments! Just say any of these phrases:
• "book an appointment"
• "call me"
• "schedule a meeting"
• "I need an appointment"

I'll guide you through the process and collect your details for scheduling.
  `;
  
  addMessage('model', helpMessage.trim());
}

// Initialize chat window as hidden when page loads
document.addEventListener('DOMContentLoaded', function() {
  // Start with chat window hidden
  chatWindow.classList.add('hide');
  
  // Initialize session
  initializeSession();
  
  // Update initial greeting to mention appointment booking
  const initialGreeting = document.querySelector('.model p');
  if (initialGreeting) {
    initialGreeting.innerHTML = 'Hi, how can I help you? You can also upload documents, ask questions, or say "book an appointment" or "call me" if you need to schedule a meeting with us!';
  }
});

// Event Listeners
console.log('Setting up event listeners...');

if (sendButton) {
  sendButton.addEventListener('click', sendMessage);
  console.log('Send button event listener added');
} else {
  console.error('Send button not found!');
}

if (uploadButton) {
  uploadButton.addEventListener('click', handleUploadButtonClick);
  console.log('Upload button event listener added');
} else {
  console.error('Upload button not found!');
}

if (fileInput) {
  fileInput.addEventListener('change', handleFileSelect);
  console.log('File input event listener added');
} else {
  console.error('File input not found!');
}

if (chatInput) {
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });
  console.log('Chat input event listener added');
} else {
  console.error('Chat input not found!');
}

// Add some helpful commands
window.showAppointments = async function() {
  try {
    const response = await fetch('/appointments');
    const data = await response.json();
    console.log('Appointments:', data.appointments);
    
    if (data.appointments && data.appointments.length > 0) {
      const appointmentList = data.appointments.map((apt, index) => 
        `${index + 1}. ${apt.Name} - ${apt.Email} - ${apt.Phone} - ${apt['Appointment Time']} (${apt.Status})`
      ).join('\n');
      
      addMessage('model', `Found ${data.appointments.length} appointments:\n\n${appointmentList}`);
    } else {
      addMessage('model', 'No appointments found.');
    }
  } catch (error) {
    console.error('Error fetching appointments:', error);
    addMessage('model', 'Sorry, I could not fetch the appointments.');
  }
};

// Expose help function
window.appointmentHelp = showAppointmentHelp;