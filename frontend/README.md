# DexVault Frontend

React frontend application for DexVault media collection manager. Provides a modern, responsive interface for managing and searching your movie and music collections.

## Features

- **Media Search**: Advanced search with multiple filters for movies and music
- **Media Management**: Add, edit, and view movie and music details
- **CSV Import**: Upload and process CSV files with column mapping
- **Image Gallery**: View movie posters, backdrops, and music covers
- **Responsive Design**: Works on desktop and mobile devices
- **Hot Reloading**: Fast development with instant updates

## Architecture

### Core Components

- **React 19**: Modern React with hooks and functional components
- **React Router**: Client-side routing with basename support
- **CSS Modules**: Scoped styling for components
- **API Service**: Centralized API communication
- **Context API**: State management for global state

### Project Structure

```
frontend/
├── public/                 # Static assets
│   ├── index.html         # Main HTML template
│   ├── manifest.json      # PWA manifest
│   └── favicon.ico        # Site icon
├── src/
│   ├── components/        # Reusable UI components
│   │   ├── MovieSearch.js
│   │   ├── MovieThumbnail.js
│   │   ├── MovieDetailCard.js
│   │   ├── MovieForm.js
│   │   ├── MovieImport.js
│   │   ├── UnmatchedMovies.js
│   │   ├── AutocompleteInput.js
│   │   ├── CircularProgressBar.js
│   │   ├── CogDropdown.js
│   │   ├── ColumnMappingModal.js
│   │   └── PosterModal.js
│   ├── pages/            # Page components
│   │   ├── AddMovie.js
│   │   ├── AddMovieSimple.js
│   │   └── ImportPage.js
│   ├── services/         # API and utility services
│   │   └── api.js        # API service layer
│   ├── App.js            # Main application component
│   ├── App.css           # Global styles
│   ├── index.js          # Application entry point
│   └── index.css         # Global CSS reset
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## Components

### Core Components

#### MovieSearch
Main search interface with filters and results display.

**Props:**
- `refreshTrigger` - Triggers search refresh
- `ref` - Reference for external control

**Features:**
- Real-time search
- Multiple filter options
- Pagination
- Export functionality

#### MovieThumbnail
Displays movie poster with basic information.

**Props:**
- `movie` - Movie object
- `onClick` - Click handler
- `showDetails` - Show additional details

#### MovieDetailCard
Comprehensive movie information display.

**Props:**
- `movie` - Movie object
- `onClose` - Close handler
- `onEdit` - Edit handler

#### MovieForm
Form for adding/editing movies.

**Props:**
- `movie` - Initial movie data
- `onSubmit` - Submit handler
- `onCancel` - Cancel handler

### Import Components

#### MovieImport
CSV import interface with file upload.

**Features:**
- File upload with validation
- Column mapping interface
- Progress tracking
- Error handling

#### UnmatchedMovies
Handles resolution of unmatched movies during import.

**Props:**
- `importId` - Import session ID
- `onComplete` - Completion handler

#### ColumnMappingModal
Modal for mapping CSV columns to database fields.

**Props:**
- `isOpen` - Modal visibility
- `onClose` - Close handler
- `onConfirm` - Confirm handler
- `columns` - Available columns

### Utility Components

#### AutocompleteInput
Input field with autocomplete suggestions.

**Props:**
- `value` - Input value
- `onChange` - Change handler
- `onSelect` - Selection handler
- `placeholder` - Placeholder text
- `fetchSuggestions` - Suggestion fetch function

#### CircularProgressBar
Animated progress indicator.

**Props:**
- `progress` - Progress percentage (0-100)
- `size` - Size in pixels
- `strokeWidth` - Stroke width
- `color` - Progress color

#### CogDropdown
Settings dropdown menu.

**Props:**
- `onImportMovies` - Import handler
- `onAddMovie` - Add movie handler
- `onExportCSV` - Export handler

## Pages

### AddMovie
Full-featured movie addition page with search and form.

**Features:**
- TMDB movie search
- Auto-fill form data
- Image preview
- Validation

### AddMovieSimple
Simplified movie addition with basic search.

**Features:**
- Quick search
- Simple form
- Fast submission

### ImportPage
CSV import management page.

**Features:**
- File upload
- Column mapping
- Progress tracking
- Unmatched resolution

## Services

### API Service

Centralized API communication with automatic base URL detection.

```javascript
import apiService from './services/api';

// Search movies
const movies = await apiService.searchMovies({
  query: 'action',
  genre: 'Action',
  year: 2023
});

// Add movie
const movie = await apiService.addMovie(movieData);

// Get movie details
const details = await apiService.getMovieDetails(id);

// Start import
const importId = await apiService.startImport(file, mapping);

// Get import status
const status = await apiService.getImportStatus(importId);
```

**Features:**
- Automatic base URL detection
- Error handling
- Request/response logging
- Image URL generation

## Styling

### CSS Architecture

- **Global Styles**: `index.css` for reset and base styles
- **Component Styles**: Individual CSS files for each component
- **CSS Modules**: Scoped styling to prevent conflicts
- **Responsive Design**: Mobile-first approach

### Design System

#### Colors
- Primary: #007bff
- Secondary: #6c757d
- Success: #28a745
- Warning: #ffc107
- Danger: #dc3545
- Info: #17a2b8

#### Typography
- Font Family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto
- Headings: 1.5rem - 3rem
- Body: 1rem
- Small: 0.875rem

#### Spacing
- Base unit: 0.25rem (4px)
- Common spacing: 0.5rem, 1rem, 1.5rem, 2rem, 3rem

## Development

### Prerequisites

- Node.js (v18 or higher)
- npm

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development server:**
   ```bash
   npm start
   ```

3. **Access the application:**
   - Development: `http://localhost:3000`
   - Production: `http://localhost:3001/app/`

### Available Scripts

- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run eject` - Eject from Create React App

### App Icons

The selected Tonique artwork is kept in `assets/dexvault-icon.png`. From the
repository root, run `node scripts/generate-icons.js` to regenerate the iPhone
180 px icon, PWA icons, and SVG/ICO favicons. Keep the artwork square and opaque;
the operating system applies its own rounded mask.

### Development Mode

The frontend runs in development mode with:
- Hot reloading on file changes
- Source maps for debugging
- ESLint warnings in console
- Fast refresh for React components

### Production Build

The production build includes:
- Minified JavaScript and CSS
- Optimized images
- Source maps (for dev builds)
- Tree shaking for smaller bundles

## API Integration

### Base URL Configuration

The frontend automatically detects the correct API base URL:

1. **Development**: Uses proxy to `http://localhost:3001`
2. **Production**: Uses relative paths (`/api/`)
3. **Injected**: Backend can inject `window.REACT_APP_BASE_URL`

### Error Handling

Consistent error handling across all API calls:

```javascript
try {
  const result = await apiService.searchMovies(query);
  // Handle success
} catch (error) {
  console.error('Search failed:', error);
  // Handle error
}
```

## Routing

### React Router Configuration

```javascript
<Router basename="/app">
  <Routes>
    <Route path="/" element={<MovieSearch />} />
    <Route path="/add-movie" element={<AddMovie />} />
    <Route path="/add-movie-simple" element={<AddMovieSimple />} />
    <Route path="/import" element={<ImportPage />} />
  </Routes>
</Router>
```

### URL Structure

- `/app/` - Home page (MovieSearch)
- `/app/add-movie` - Full movie addition
- `/app/add-movie-simple` - Simple movie addition
- `/app/import` - CSV import page

## State Management

### Local State

Components use React hooks for local state:

```javascript
const [movies, setMovies] = useState([]);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);
```

### Global State

Shared state is managed through:
- Context API for theme and user preferences
- Props drilling for component communication
- URL parameters for search state

## Performance

### Optimization Techniques

- **Code Splitting**: Lazy loading of components
- **Memoization**: React.memo for expensive components
- **Image Optimization**: Lazy loading and responsive images
- **Bundle Analysis**: Webpack bundle analyzer

### Best Practices

- Use functional components with hooks
- Minimize re-renders with proper dependencies
- Optimize images and assets
- Use production builds for deployment

## Testing

### Test Structure

- **Unit Tests**: Component testing with React Testing Library
- **Integration Tests**: API integration testing
- **E2E Tests**: Full user flow testing (future)

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

## Deployment

### Build Process

1. **Development Build**:
   ```bash
   npm run build
   # Creates optimized build in build/
   ```

2. **Production Build**:
   ```bash
   npm run build:prod
   # Creates production build with minification
   ```

### Static File Serving

The built frontend is served by the Express backend:
- Static files: `/app/static/`
- Main app: `/app/`
- API calls: `/api/`

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Accessibility

- Semantic HTML elements
- ARIA labels and roles
- Keyboard navigation support
- Screen reader compatibility
- Color contrast compliance

## Future Enhancements

- PWA support
- Offline functionality
- Advanced filtering
- Bulk operations
- User authentication
- Data synchronization
