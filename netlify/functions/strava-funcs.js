exports.handler = async (event, context) => {
  // Define allowed origins
  const allowedOrigins = [
    'https://nicolas-mich3l.github.io',
    'http://127.0.0.1:5500',
    'http://localhost:5500'
  ];

  // Get the origin from the request
  const origin = event.headers.origin;
  const corsOrigin = allowedOrigins.includes(origin) ? origin : 'https://nicolas-mich3l.github.io';
  
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Environment variables
    const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
    const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
    let ACCESS_TOKEN = process.env.STRAVA_ACCESS_TOKEN;
    const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;

    if (!CLIENT_ID || !CLIENT_SECRET || !ACCESS_TOKEN || !REFRESH_TOKEN) {
      throw new Error('Missing required Strava credentials');
    }

    // Function to refresh access token
    const refreshAccessToken = async () => {
      const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: REFRESH_TOKEN,
          grant_type: 'refresh_token'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to refresh access token');
      }

      const data = await response.json();
      return data.access_token;
    };

    // Function to make authenticated Strava API calls
    const stravaRequest = async (url, token = ACCESS_TOKEN) => {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // If unauthorized, try refreshing token
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        const retryResponse = await fetch(url, {
          headers: { 'Authorization': `Bearer ${newToken}` }
        });
        
        if (!retryResponse.ok) {
          throw new Error(`Strava API error: ${retryResponse.status}`);
        }
        
        return retryResponse.json();
      }

      if (!response.ok) {
        throw new Error(`Strava API error: ${response.status}`);
      }

      return response.json();
    };

    // Get profile
    const athlete = await stravaRequest('https://www.strava.com/api/v3/athlete');
    
    // Get recent activities (last 30 activities to analyze for PRs)
    const activities = await stravaRequest('https://www.strava.com/api/v3/athlete/activities?per_page=30');

    // Get segment efforts for KOMs and top 10s
    const segmentEfforts = [];
    for (const activity of activities.slice(0, 10)) { // Limit to recent 10 activities to avoid rate limits
      try {
        const efforts = await stravaRequest(`https://www.strava.com/api/v3/activities/${activity.id}/segments`);
        segmentEfforts.push(...efforts);
      } catch (error) {
        console.log(`Error fetching segments for activity ${activity.id}:`, error.message);
      }
    }

    // Process Personal Records (PRs)
    const personalRecords = activities
      .filter(activity => activity.pr_count > 0)
      .map(activity => ({
        id: activity.id,
        name: activity.name,
        type: activity.type,
        date: activity.start_date,
        distance: activity.distance,
        moving_time: activity.moving_time,
        elapsed_time: activity.elapsed_time,
        total_elevation_gain: activity.total_elevation_gain,
        pr_count: activity.pr_count,
        achievement_count: activity.achievement_count
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10); // Get last 10 PRs

    // Process KOMs (King of the Mountain trophies)
    const koms = segmentEfforts
      .filter(effort => effort.kom_rank === 1)
      .map(effort => ({
        segment_id: effort.segment.id,
        segment_name: effort.segment.name,
        activity_id: effort.activity.id,
        elapsed_time: effort.elapsed_time,
        moving_time: effort.moving_time,
        distance: effort.segment.distance,
        average_grade: effort.segment.average_grade,
        maximum_grade: effort.segment.maximum_grade,
        elevation_high: effort.segment.elevation_high,
        elevation_low: effort.segment.elevation_low,
        start_date: effort.start_date
      }))
      .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

    // Process Top 10 placements
    const top10Placements = segmentEfforts
      .filter(effort => effort.kom_rank && effort.kom_rank <= 10 && effort.kom_rank > 1)
      .map(effort => ({
        segment_id: effort.segment.id,
        segment_name: effort.segment.name,
        activity_id: effort.activity.id,
        rank: effort.kom_rank,
        elapsed_time: effort.elapsed_time,
        moving_time: effort.moving_time,
        distance: effort.segment.distance,
        average_grade: effort.segment.average_grade,
        maximum_grade: effort.segment.maximum_grade,
        elevation_high: effort.segment.elevation_high,
        elevation_low: effort.segment.elevation_low,
        start_date: effort.start_date
      }))
      .sort((a, b) => a.rank - b.rank || new Date(b.start_date) - new Date(a.start_date));

    // Return the data
    const result = {
      athlete: {
        id: athlete.id,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
        profile: athlete.profile
      },
      personalRecords,
      koms,
      top10Placements,
      lastUpdated: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to fetch Strava data',
        message: error.message
      })
    };
  }
};