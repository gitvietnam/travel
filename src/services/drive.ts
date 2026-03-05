import { google } from 'googleapis';
import fs from 'fs';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export class GoogleDriveService {
  private driveClient;
  private folderId: string;

  constructor() {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'); // Handle newline characters
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '';

    if (clientEmail && privateKey && this.folderId) {
      const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: SCOPES,
      });
      this.driveClient = google.drive({ version: 'v3', auth });
    }
  }

  isConfigured(): boolean {
    return !!this.driveClient && !!this.folderId;
  }

  async uploadFile(filePath: string, fileName: string, mimeType: string): Promise<string> {
    if (!this.driveClient) {
      throw new Error('Google Drive client is not configured');
    }

    try {
      const response = await this.driveClient.files.create({
        requestBody: {
          name: fileName,
          parents: [this.folderId],
        },
        media: {
          mimeType: mimeType,
          body: fs.createReadStream(filePath),
        },
        fields: 'id, webViewLink, webContentLink',
      });

      const fileId = response.data.id;
      
      // Set permission to anyone with the link (public) so it can be viewed in the app
      await this.driveClient.permissions.create({
        fileId: fileId!,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      // Construct a direct embed link (more reliable for <img> tags than webContentLink)
      // Using the 'uc' (User Content) export link pattern
      return `https://drive.google.com/uc?export=view&id=${fileId}`;
    } catch (error) {
      console.error('Google Drive upload error:', error);
      throw error;
    }
  }
}
