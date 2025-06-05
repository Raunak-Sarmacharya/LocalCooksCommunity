# Microlearning System - Government of Canada Food Safety Training

## Overview

The Local Cooks microlearning system provides free, comprehensive food safety training featuring official content from Health Canada and the Canadian Food Inspection Agency (CFIA). The system is designed to be accessible to everyone, regardless of food safety certification status.

### Key Features

- **Government of Canada Approved Content**: Official training materials from Health Canada and CFIA
- **Public Access**: No registration or authentication required
- **Self-Paced Learning**: Complete training at your own pace with automatic progress saving
- **Mobile Responsive**: Works on desktop, tablet, and mobile devices
- **Certificate Generation**: Official completion certificates aligned with Safe Food for Canadians Regulations
- **Progress Tracking**: Real-time progress monitoring and completion status

## Training Modules

The system includes three core modules featuring official Canadian government content:

### 1. Safe Food Handling Basics (8:45)
- **Source**: Health Canada
- **Certification**: Government of Canada Approved
- **Content**: Fundamentals of safe food handling, temperature control, and personal hygiene
- **URL**: Health Canada approved training materials

### 2. Preventing Food Contamination (6:30)
- **Source**: Canadian Food Inspection Agency (CFIA)
- **Certification**: Federal Government Standards
- **Content**: CFIA guidelines for preventing cross-contamination and maintaining food safety standards
- **URL**: CFIA official training content

### 3. Allergen Awareness and Management (5:15)
- **Source**: Canadian Food Inspection Agency (CFIA)
- **Certification**: Safe Food for Canadians Regulations
- **Content**: Safe Food for Canadians Regulations compliance for allergen identification and control
- **URL**: CFIA allergen management training

## Architecture

### Frontend Components

#### MicrolearningModule.tsx
- Main orchestrator component
- Manages video progression and completion workflow
- Handles participant information collection for certification
- Integrates with video player and progress tracking
- Removed authentication dependencies for public access

#### VideoPlayer.tsx
- Custom video player with 90% completion requirement
- Real-time progress tracking
- Play/pause/seek/volume controls
- Visual completion overlays
- Mobile-responsive design

#### CompletionTracker.tsx
- Real-time progress visualization
- Individual video status with timestamps
- Overall progress indicators
- Visual status badges

#### Microlearning.tsx (Page)
- Public landing page with no authentication required
- Hero section highlighting government approval
- Feature showcase
- Self-contained user ID generation for progress tracking

### Backend Implementation

#### API Endpoints (Public Access)

All microlearning endpoints are now publicly accessible:

**GET `/api/microlearning/progress/:userId`**
- Retrieves user progress for any user ID
- No authentication required
- Returns progress array and completion status

**POST `/api/microlearning/progress`**
- Updates video progress for any user
- No authentication required
- Accepts: userId, videoId, progress, completed, completedAt

**POST `/api/microlearning/complete`**
- Completes microlearning with participant information
- No authentication required
- Accepts: userId, completionDate, videoProgress, participantName, participantEmail
- Updated video IDs for Canadian content: 'canada-food-handling', 'canada-contamination-prevention', 'canada-allergen-awareness'

**GET `/api/microlearning/certificate/:userId`**
- Generates completion certificate
- No authentication required
- Returns certificate URL and completion information

### Anonymous User Handling

The system generates temporary user IDs for anonymous users:
- IDs are stored in localStorage for progress persistence
- Format: Random 7-digit number (1000000-1999999)
- Allows progress tracking without user accounts
- Participant information collected at completion for certification

## Configuration

### Environment Variables

```bash
# Optional - for enhanced certificate integration
ALWAYS_FOOD_SAFE_API_KEY=your_api_key_here
ALWAYS_FOOD_SAFE_API_URL=https://api.alwaysfoodsafe.com
```

### Video Content Sources

The system references official Canadian government video content:

```typescript
const videos = [
  {
    id: 'canada-food-handling',
    url: 'https://www.canada.ca/content/dam/hc-sc/videos/health/food-safety/food-handling-basics.mp4',
    source: 'Health Canada',
    certification: 'Government of Canada Approved'
  },
  // ... additional videos
];
```

## Usage

### Accessing the Training

1. **Navigate to `/microlearning`** - No login required
2. **Automatic Progress Tracking** - System generates temporary user ID
3. **Complete Videos** - Watch each video to 90% completion
4. **Provide Information** - Enter name and email for certification
5. **Receive Certificate** - Download official completion certificate

### Integration Options

#### Standalone Access
- Direct access via `/microlearning` route
- No authentication barriers
- Self-contained progress tracking

#### Application Integration
- Link from certification forms for users selecting "Not yet, but I'd like to learn"
- Seamless integration with existing user flows
- Optional enhanced tracking for registered users

## Compliance and Certification

### Government Approval
- Content sourced from Health Canada and CFIA
- Aligned with Safe Food for Canadians Regulations
- Federal government standards compliance

### Certificate Features
- Official completion certification
- Participant name and completion date
- Government source attribution
- Regulatory compliance notation

## Technical Requirements

### Frontend Dependencies
- React with TypeScript
- Wouter for routing
- Framer Motion for animations
- Lucide React for icons
- Custom UI components (shadcn/ui)

### Backend Dependencies
- Express.js server
- Storage interface (MemStorage/DatabaseStorage)
- Optional Always Food Safe API integration

## Future Enhancements

### Planned Features
1. **PDF Certificate Generation** - Automated certificate PDF creation
2. **Email Delivery** - Certificate delivery via email
3. **Progress Analytics** - Detailed completion analytics
4. **Multi-language Support** - French language support for bilingual compliance
5. **Offline Capability** - Progressive Web App features for offline access
6. **Enhanced Integration** - Integration with provincial food safety databases

### Scalability Considerations
- CDN integration for video delivery
- Caching strategies for progress data
- Load balancing for high traffic periods
- Performance monitoring and optimization

## Support and Maintenance

### Monitoring
- Track completion rates and user engagement
- Monitor video playback performance
- Certificate generation success rates

### Updates
- Regular content updates from government sources
- Security patches and dependency updates
- Performance optimizations

### Troubleshooting
- Video playback issues: Check network connectivity and video URLs
- Progress not saving: Verify localStorage availability
- Certificate generation: Check API endpoint availability

## License

This microlearning system is part of the Local Cooks platform and follows the same licensing terms. 