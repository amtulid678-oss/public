import { GoogleGenerativeAI } from "@google/generative-ai";
import express from "express";
import multer from "multer";
import fs from "fs";

const app = express();
const PORT = 3000;

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Create appointments.csv file if it doesn't exist
const csvFilePath = 'appointments.csv';
if (!fs.existsSync(csvFilePath)) {
  const csvHeader = 'Date,Name,Email,Phone,Purpose,Appointment Time,Appointment Date,Status\n';
  fs.writeFileSync(csvFilePath, csvHeader);
}

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

// Middleware
app.use(express.json());
app.use(express.text());

// Serve static files (HTML, CSS, JS)
app.use(express.static('.'));

// Initialize Google GenAI with the correct SDK
const genAI = new GoogleGenerativeAI('AIzaSyC63CwDLGDByxWmUXVjYRb-35xks2kxIFg');

// Get the model
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Chat history to maintain context
let chatHistory = [
  {
    role: "user",
    parts: [{ text: "Hello" }],
  },
  {
    role: "model",
    parts: [{ text: "Greetings! How can I help you? I can assist you with general questions or help you book an appointment if needed." }],
  },
];

// Store user sessions for appointment booking
const userSessions = new Map();

// Helper function to check if message indicates appointment booking
function isAppointmentRequest(message) {
  const appointmentKeywords = [
    'call me', 'book an appointment', 'schedule appointment', 
    'book appointment', 'appointment', 'schedule a call', 
    'schedule meeting', 'need a call', 'want to book', 
    'set up meeting', 'arrange a call'
  ];
  const lowerMessage = message.toLowerCase();
  return appointmentKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to validate phone number
function isValidPhone(phone) {
  const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  return cleanPhone.length >= 10 && /^\+?[0-9]+$/.test(cleanPhone);
}

// Helper function to get next available business day
function getNextBusinessDay() {
  const today = new Date();
  let nextDay = new Date(today);
  nextDay.setDate(today.getDate() + 1);
  
  // Skip weekends
  while (nextDay.getDay() === 0 || nextDay.getDay() === 6) {
    nextDay.setDate(nextDay.getDate() + 1);
  }
  
  return nextDay;
}

// Helper function to suggest appointment times
function suggestAppointmentTimes() {
  const nextBusinessDay = getNextBusinessDay();
  const times = ['9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM', '4:00 PM'];
  
  const formattedDate = nextBusinessDay.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  return `Available slots for ${formattedDate}: ${times.join(', ')}. Please let me know which time works best for you.`;
}

// Helper function to validate appointment time
function isValidAppointmentTime(timeStr) {
  const validTimes = [
    '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', 
    '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', 
    '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM'
  ];
  
  // Normalize the time string
  const normalizedTime = timeStr.trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/(\d{1,2}):?(\d{2})?\s*(AM|PM)/i, (match, hour, minute, period) => {
      const h = hour.padStart(1, '0');
      const m = minute || '00';
      return `${h}:${m} ${period}`;
    });
  
  return validTimes.includes(normalizedTime);
}

// Function to save appointment to CSV
function saveAppointmentToCSV(appointmentData) {
  const { name, email, phone, purpose, appointmentTime} = appointmentData;
  const currentDate = new Date().toISOString().split('T')[0];
  const appointmentDate = getNextBusinessDay().toISOString().split('T')[0];
  const status = 'Scheduled';
  
  // Escape quotes in data and wrap in quotes
  const escapedName = `"${name.replace(/"/g, '""')}"`;
  const escapedEmail = `"${email.replace(/"/g, '""')}"`;
  const escapedPhone = `"${phone.replace(/"/g, '""')}"`;
  const escapedPurpose = `"${(purpose || 'General consultation').replace(/"/g, '""')}"`;
  const escapedTime = `"${appointmentTime.replace(/"/g, '""')}"`;
  const escapedStatus = `"${status}"`;
  
  const csvRow = `${appointmentDate},${escapedName},${escapedEmail},${escapedPhone},${escapedPurpose},${escapedTime},${escapedStatus}\n`;
  
  console.log('Saving appointment:', csvRow);
  fs.appendFileSync(csvFilePath, csvRow);
}

// Handle appointment booking flow
function handleAppointmentFlow(sessionId, message, sessionData) {
  const step = sessionData.step || 'start';
  let response = '';
  let nextStep = step;

  console.log(`Appointment flow - Session: ${sessionId}, Step: ${step}, Message: ${message}`);

  switch (step) {
    case 'start':
      response = "I'd be happy to help you book an appointment! Let's start by getting your name. What should I call you?";
      nextStep = 'name';
      break;

    case 'name':
      const name = message.trim();
      if (name.length < 2) {
        response = "Please provide a valid name with at least 2 characters.";
        nextStep = 'name'; // Stay on same step
      } else {
        sessionData.name = name;
        response = `Nice to meet you, ${sessionData.name}! Could you please provide your email address?`;
        nextStep = 'email';
      }
      break;

    case 'email':
      const email = message.trim();
      if (!isValidEmail(email)) {
        response = "Please provide a valid email address (e.g., john@example.com).";
        nextStep = 'email'; // Stay on same step
      } else {
        sessionData.email = email;
        response = `Great! Now I need your phone number for contact purposes.`;
        nextStep = 'phone';
      }
      break;

    case 'phone':
      const phone = message.trim();
      if (!isValidPhone(phone)) {
        response = "Please provide a valid phone number with at least 10 digits (e.g., +1-234-567-8900 or 1234567890).";
        nextStep = 'phone'; // Stay on same step
      } else {
        sessionData.phone = phone;
        response = `Perfect! What's the purpose of your appointment? (e.g., consultation, meeting, support, etc.)`;
        nextStep = 'purpose';
      }
      break;

    case 'purpose':
      sessionData.purpose = message.trim();
      response = `Thank you! Now let's schedule your appointment. ${suggestAppointmentTimes()}`;
      nextStep = 'time';
      break;

    case 'time':
      const appointmentTime = message.trim();
      if (!isValidAppointmentTime(appointmentTime)) {
        response = `Please choose from the available time slots. ${suggestAppointmentTimes()}`;
        nextStep = 'time'; // Stay on same step
      } else {
        sessionData.appointmentTime = appointmentTime;
        
        // Save to CSV
        try {
          console.log('Attempting to save appointment:', sessionData);
          saveAppointmentToCSV(sessionData);
          
          const appointmentDate = getNextBusinessDay().toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
          
          response = `Perfect! Your appointment has been scheduled successfully. Here's a summary:

📅 Name: ${sessionData.name}
📧 Email: ${sessionData.email}
📱 Phone: ${sessionData.phone}
🎯 Purpose: ${sessionData.purpose}
⏰ Time: ${sessionData.appointmentTime} on ${appointmentDate}

You'll receive a confirmation email shortly. Is there anything else I can help you with?`;
          
          // Clear session after successful booking
          userSessions.delete(sessionId);
          return { response, isComplete: true };
          
        } catch (error) {
          console.error('Error saving appointment:', error);
          response = "I'm sorry, there was an error saving your appointment. Please try again or contact support.";
          userSessions.delete(sessionId);
          return { response, isComplete: true };
        }
      }
      break;
  }

  // Update session with new step
  sessionData.step = nextStep;
  userSessions.set(sessionId, sessionData);
  
  console.log('Updated session data:', sessionData);
  
  return { response, isComplete: false };
}

// Function to read file content
function readFileContent(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Error reading file: ${error.message}`);
  }
}

// Regular chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    console.log('Received message:', message, 'SessionID:', sessionId);
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Use provided sessionId or generate one
    const currentSessionId = sessionId || (req.ip + '_' + Date.now());
    
    // Check if user is in appointment booking flow OR wants to start booking
    const isCurrentlyBooking = userSessions.has(currentSessionId);
    const wantsToBook = isAppointmentRequest(message);
    
    console.log('Booking check:', { isCurrentlyBooking, wantsToBook, sessionId: currentSessionId });
    
    if (isCurrentlyBooking || wantsToBook) {
      let sessionData = userSessions.get(currentSessionId) || {};
      
      // If it's a new booking request, reset session data
      if (wantsToBook && !isCurrentlyBooking) {
        sessionData = { step: 'start' };
      }
      
      const appointmentResult = handleAppointmentFlow(currentSessionId, message, sessionData);
      
      if (appointmentResult.isComplete) {
        // Add to chat history for context
        chatHistory.push(
          { role: "user", parts: [{ text: message }] },
          { role: "model", parts: [{ text: appointmentResult.response }] }
        );
      }
      
      return res.json({ response: appointmentResult.response });
    }

    // Regular AI chat flow
    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        maxOutputTokens: 1800,
        temperature: 0.1,
      },
    });

    // Enhanced prompt to mention appointment booking capability
    const enhancedMessage = message + "\n\nNote: If the user asks about booking appointments, calling, or scheduling, let them know I can help with that by saying phrases like 'book an appointment' or 'call me'. Please respond in plain text without any markdown formatting.";
    
    const result = await chat.sendMessage(enhancedMessage);
    const response = await result.response;
    const botResponse = response.text();
    
    // Update chat history
    chatHistory.push(
      { role: "user", parts: [{ text: message }] },
      { role: "model", parts: [{ text: botResponse }] }
    );
    
    // Keep history manageable (last 20 exchanges)
    if (chatHistory.length > 20) {
      chatHistory = chatHistory.slice(-20);
    }
    
    console.log("Chatbot response:", botResponse);
    
    // Send response back to client
    res.json({ response: botResponse });
    
  } catch (error) {
    console.error("Error processing chat:", error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// File upload chat endpoint
app.post('/chat-with-file', upload.single('file'), async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const file = req.file;
    
    console.log('Received file upload request');
    console.log('File:', file ? file.originalname : 'No file');
    console.log('Message:', message);
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Read file content (for now, only handle text files)
    let fileContent = '';
    try {
      fileContent = readFileContent(file.path);
    } catch (error) {
      // Clean up file
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Could not read file. Please ensure it is a text file.' });
    }
    
    // Create a chat session with current history
    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        maxOutputTokens: 1800,
        temperature: 0.1,
      },
    });
    
    const prompt = `Here is the content of the uploaded file "${file.originalname}":\n\n${fileContent}\n\n${message || 'Please analyze this document and provide a summary.'}\n\nPlease respond in plain text without any markdown formatting. But you can add spaces and text more attractive`;
    
    console.log('Sending to AI...');
    
    // Send to AI
    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    const botResponse = response.text();
    
    // Update chat history
    const userMessage = `[Uploaded file: ${file.originalname}] ${message || 'Please analyze this document'}`;
    chatHistory.push(
      { role: "user", parts: [{ text: userMessage }] },
      { role: "model", parts: [{ text: botResponse }] }
    );
    
    // Keep history manageable
    if (chatHistory.length > 20) {
      chatHistory = chatHistory.slice(-20);
    }
    
    console.log("File analysis response received");
    
    // Clean up uploaded file
    fs.unlinkSync(file.path);
    
    // Send response back to client
    res.json({ response: botResponse });
    
  } catch (error) {
    console.error("Error processing file chat:", error);
    
    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: 'Error processing file: ' + error.message });
  }
});

// New endpoint to view appointments (optional - for admin use)
app.get('/appointments', (req, res) => {
  try {
    if (fs.existsSync(csvFilePath)) {
      const csvContent = fs.readFileSync(csvFilePath, 'utf8');
      const lines = csvContent.split('\n').filter(line => line.trim());
      
      if (lines.length <= 1) {
        return res.json({ appointments: [] });
      }
      
      // Convert CSV to JSON for easier viewing
      const headers = ['Date', 'Name', 'Email', 'Phone', 'Purpose', 'Appointment Time', 'Status'];
      const appointments = lines.slice(1).map(line => {
        // Simple CSV parsing - handle quoted values
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim()); // Add last value
        
        const appointment = {};
        headers.forEach((header, index) => {
          appointment[header] = values[index] ? values[index].replace(/^"|"$/g, '') : '';
        });
        return appointment;
      });
      
      res.json({ appointments });
    } else {
      res.json({ appointments: [] });
    }
  } catch (error) {
    console.error("Error reading appointments:", error);
    res.status(500).json({ error: 'Error reading appointments: ' + error.message });
  }
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Upload directory created/verified');
  console.log('Appointments CSV file ready');
});