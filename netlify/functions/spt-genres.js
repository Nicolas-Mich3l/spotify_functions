exports.handler = async (event, context) => {
  // Get environment variables
  const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': 'https://nicolas-mich3l.github.io/',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  
  try {
    // Debug logging
    console.log('Environment check:');
    console.log('CLIENT_ID exists:', !!CLIENT_ID);
    console.log('CLIENT_SECRET exists:', !!CLIENT_SECRET);
    console.log('REFRESH_TOKEN exists:', !!REFRESH_TOKEN);
    
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
      throw new Error('Missing required environment variables');
    }
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
      },
      body: `grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}`
    });

    const tokenData = await tokenResponse.json();
    console.log('Token response status:', tokenResponse.status);
    console.log('Token response error:', tokenData.error);

    if (tokenData.error) {
      console.error('Full token error response:', tokenData);
      throw new Error(`Token refresh failed: ${tokenData.error} - ${tokenData.error_description || 'No description'}`);
    }

    const accessToken = tokenData.access_token;

    // Get recently played tracks
    const recentTracksResponse = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const recentTracksData = await recentTracksResponse.json();

    if (recentTracksData.error) {
      throw new Error(`Spotify API error: ${recentTracksData.error.message}`);
    }

    // Extract unique artist IDs
    const artistIds = [...new Set(
      recentTracksData.items.flatMap(item => 
        item.track.artists.map(artist => artist.id)
      )
    )];

    // Get artist details (including genres) in batches
    const genres = new Map();
    const batchSize = 50; // Spotify API limit

    for (let i = 0; i < artistIds.length; i += batchSize) {
      const batch = artistIds.slice(i, i + batchSize);
      const artistsResponse = await fetch(
        `https://api.spotify.com/v1/artists?ids=${batch.join(',')}`, 
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      const artistsData = await artistsResponse.json();

      if (artistsData.error) {
        console.error('Artists API error:', artistsData.error);
        continue;
      }

      // Count genres
      artistsData.artists.forEach(artist => {
        if (artist && artist.genres) {
          artist.genres.forEach(genre => {
            genres.set(genre, (genres.get(genre) || 0) + 1);
          });
        }
      });
    }

    // Format response
    const sortedGenres = Array.from(genres.entries())
      .sort(([,a], [,b]) => b - a)
      .map(([genre, count]) => ({ genre, count }));

    const response = {
      timestamp: new Date().toISOString(),
      totalTracks: recentTracksData.items.length,
      totalGenres: sortedGenres.length,
      genres: sortedGenres,
      lastUpdated: new Date().toLocaleDateString()
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Function error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      }),
    };
  }
};
