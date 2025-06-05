# Microlearning System Documentation

## Overview

The Local Cooks microlearning system provides interactive food safety training through embedded videos with completion tracking and optional Always Food Safe API integration. This system helps users gain essential food safety knowledge before pursuing official certification.

## Features

### 🎥 Video Player Component
- **Custom video player** with full controls (play/pause, seek, volume, restart)
- **Progress tracking** with watch percentage monitoring
- **Completion detection** requiring 90% watch time for full completion
- **Visual feedback** with completion overlays and status indicators
- **Responsive design** that works on all devices

### 📊 Completion Tracker
- **Real-time progress** tracking across all training modules
- **Individual video status** with completion timestamps
- **Overall progress** calculation and visualization
- **Detailed progress view** showing watch percentages and completion dates
- **Visual status indicators** (not started, in progress, completed)

### 🔗 Always Food Safe API Integration
- **SCORM-compliant** training module integration
- **Completion submission** to Always Food Safe platform
- **Certificate generation** and management
- **Progress synchronization** between platforms
- **Configurable integration** (works with or without API)

## System Architecture

### Frontend Components

```
client/src/components/microlearning/
├── VideoPlayer.tsx          # Custom video player with tracking
├── CompletionTracker.tsx    # Progress tracking component
└── MicrolearningModule.tsx  # Main module orchestrator
```

### Backend API Endpoints

```
/api/microlearning/progress/:userId    # GET - Fetch user progress
/api/microlearning/progress           # POST - Update video progress
/api/microlearning/complete           # POST - Complete training
/api/microlearning/certificate/:userId # GET - Generate certificate
```

### Database Storage

The system uses both in-memory (development) and database (production) storage:

- **Video Progress**: Tracks individual video completion status
- **Microlearning Completions**: Records overall training completion
- **User Authentication**: Integrates with existing user system

## Training Modules

### Module 1: Proper Food Handling Techniques
- **Duration**: 8:45
- **Topics**: Safe food handling, storage, temperature control
- **Required**: Yes

### Module 2: Contamination Prevention
- **Duration**: 6:30
- **Topics**: Cross-contamination prevention, kitchen safety
- **Required**: Yes

### Module 3: Allergen Awareness & Management
- **Duration**: 5:15
- **Topics**: Food allergens, allergen management protocols
- **Required**: Yes

## Usage Guide

### For Users

1. **Access Training**: Navigate to `/microlearning` (requires login)
2. **Watch Videos**: Complete each module by watching 90% of the content
3. **Track Progress**: Monitor completion status in the progress tracker
4. **Confirm Completion**: Click "Confirm Completion" when all videos are done
5. **Download Certificate**: Access certificate after confirmation

### For Developers

#### Adding New Videos

```typescript
// Update TRAINING_VIDEOS array in MicrolearningModule.tsx
const TRAINING_VIDEOS: VideoData[] = [
  {
    id: 'new-module',
    title: 'New Training Module',
    description: 'Description of the new module',
    videoUrl: '/api/videos/new-module.mp4',
    duration: '10:30',
    required: true
  }
];
```

#### Customizing Video Player

```typescript
<VideoPlayer
  videoUrl={videoUrl}
  title={title}
  onStart={() => handleVideoStart(videoId)}
  onProgress={(progress) => handleVideoProgress(videoId, progress)}
  onComplete={() => handleVideoComplete(videoId)}
  requireFullWatch={true} // Require 90% completion
  autoPlay={false}
/>
```

#### Tracking Custom Events

```typescript
// Custom progress tracking
const updateVideoProgress = async (videoId: string, progress: number) => {
  await fetch('/api/microlearning/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: user.id,
      videoId,
      progress,
      completed: progress >= 90
    })
  });
};
```

## Always Food Safe Integration

### Configuration

Set environment variables for API integration:

```bash
# Always Food Safe API Configuration
ALWAYS_FOOD_SAFE_API_KEY=your_api_key_here
ALWAYS_FOOD_SAFE_API_URL=https://api.alwaysfoodsafe.com
```

### API Integration Features

- **Completion Submission**: Automatically submits completion data
- **Certificate Generation**: Generates official certificates
- **Progress Synchronization**: Syncs progress with Always Food Safe platform
- **Verification**: Verifies certificates through their API

### Integration Flow

1. User completes all required videos
2. System validates completion (90% watch requirement)
3. Completion data is submitted to Always Food Safe API
4. Certificate is generated and linked
5. User receives confirmation and certificate access

## API Reference

### Get User Progress

```http
GET /api/microlearning/progress/:userId
Authorization: Required (user or admin)
```

**Response:**
```json
{
  "success": true,
  "progress": [
    {
      "videoId": "food-handling",
      "progress": 100,
      "completed": true,
      "completedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "completionConfirmed": false
}
```

### Update Video Progress

```http
POST /api/microlearning/progress
Content-Type: application/json
Authorization: Required (user or admin)

{
  "userId": 123,
  "videoId": "food-handling",
  "progress": 75,
  "completed": false
}
```

### Complete Training

```http
POST /api/microlearning/complete
Content-Type: application/json
Authorization: Required (user or admin)

{
  "userId": 123,
  "completionDate": "2024-01-15T10:30:00Z",
  "videoProgress": [...]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Microlearning completed successfully",
  "completionConfirmed": true,
  "alwaysFoodSafeIntegration": "success",
  "certificateId": "AFS-123456",
  "certificateUrl": "https://certificates.alwaysfoodsafe.com/123456"
}
```

## Security & Privacy

### Authentication
- All endpoints require user authentication
- Users can only access their own progress data
- Admins can access all user data

### Data Protection
- Progress data is stored securely
- Video URLs are protected
- Certificate data is encrypted

### Privacy Compliance
- User data is handled according to privacy policies
- Integration with Always Food Safe follows their privacy guidelines
- Data retention policies are enforced

## Troubleshooting

### Common Issues

#### Video Won't Play
- Check video URL accessibility
- Verify file format compatibility
- Ensure proper CORS headers

#### Progress Not Saving
- Verify authentication status
- Check network connectivity
- Review browser console for errors

#### Always Food Safe Integration Failing
- Verify API key configuration
- Check API endpoint availability
- Review integration logs

### Debug Mode

Enable debug logging:

```typescript
// In MicrolearningModule.tsx
const DEBUG = process.env.NODE_ENV === 'development';

if (DEBUG) {
  console.log('Video progress:', progressData);
}
```

## Performance Optimization

### Video Loading
- Use video preloading strategies
- Implement progressive loading
- Optimize video file sizes

### Progress Tracking
- Debounce progress updates
- Batch API calls when possible
- Cache completion status

### Always Food Safe API
- Implement retry logic
- Use connection pooling
- Monitor API rate limits

## Future Enhancements

### Planned Features
- **Interactive Quizzes**: Add knowledge checks between videos
- **Adaptive Learning**: Personalized learning paths
- **Mobile App**: Native mobile application
- **Offline Mode**: Download videos for offline viewing
- **Multi-language**: Support for multiple languages

### Integration Opportunities
- **LMS Integration**: Connect with other learning management systems
- **Certification Tracking**: Advanced certificate management
- **Analytics Dashboard**: Detailed learning analytics
- **Social Features**: Peer learning and discussion forums

## Support

For technical support or questions about the microlearning system:

1. Check this documentation first
2. Review the troubleshooting section
3. Check the browser console for errors
4. Contact the development team

## License

This microlearning system is part of the Local Cooks platform and follows the same licensing terms. 