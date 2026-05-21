const https = require('https');

function pipedriveGet(path, apiToken) {
  return new Promise((resolve, reject) => {
    const url = `/v1/${path}${path.includes('?') ? '&' : '?'}api_token=${apiToken}`;
    const options = {
      hostname: 'api.pipedrive.com',
      path: url,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Field names we want to display (must match Pipedrive exactly)
const CUSTOM_FIELD_NAMES = [
  'Locked',
  'Appraisal Ordered/Due',
  'Disclosed',
  'Sub. to Processing',
  'Sub. to UW',
  '1st Loan Approval',
  'COE',
  'Loan Cont.',
  'Appraisal Cont.'
];

const ALLOWED_PIPELINES = ['Loan Pipeline', 'Lead Pipeline'];

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { secret, action, query } = JSON.parse(event.body);

    if (secret !== process.env.REALTOR_SECRET) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid access code' })
      };
    }

    const apiToken = process.env.PIPEDRIVE_API_KEY;

    if (action === 'search') {
      // Fetch deal field definitions to build name->key map
      const fieldsResult = await pipedriveGet('dealFields?limit=200', apiToken);
      const fieldMap = {}; // name -> api key
      if (fieldsResult.success && fieldsResult.data) {
        fieldsResult.data.forEach(f => {
          fieldMap[f.name] = f.key;
        });
      }

      // Search for person by name or email
      const searchResult = await pipedriveGet(
        `persons/search?term=${encodeURIComponent(query)}&fields=name,email&limit=10`,
        apiToken
      );

      if (!searchResult.success || !searchResult.data || !searchResult.data.items.length) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ results: [] })
        };
      }

      const persons = searchResult.data.items.slice(0, 5);
      const results = [];

      for (const item of persons) {
        const person = item.item;

        // Get deals for this person
        const dealsResult = await pipedriveGet(
          `persons/${person.id}/deals?status=all_not_deleted&limit=10`,
          apiToken
        );

        const allDeals = dealsResult.success && dealsResult.data ? dealsResult.data : [];

        // Filter to Loan Pipeline and Lead Pipeline only
        const filteredDeals = allDeals.filter(deal =>
          ALLOWED_PIPELINES.includes(deal.pipeline_name)
        );

        const dealsWithDetails = [];
        for (const deal of filteredDeals.slice(0, 3)) {
          // Get latest note
          let latestNote = null;
          try {
            const notesResult = await pipedriveGet(
              `notes?deal_id=${deal.id}&limit=1&sort=add_time DESC`,
              apiToken
            );
            if (notesResult.success && notesResult.data && notesResult.data.length) {
              latestNote = notesResult.data[0].content;
              latestNote = latestNote.replace(/<[^>]*>/g, '').trim();
              if (latestNote.length > 150) latestNote = latestNote.substring(0, 150) + '...';
            }
          } catch(e) {}

          // Extract custom fields using the field map
          const customFields = {};
          CUSTOM_FIELD_NAMES.forEach(name => {
            const key = fieldMap[name];
            if (key && deal[key] !== undefined && deal[key] !== null && deal[key] !== '') {
              customFields[name] = deal[key];
            }
          });

          dealsWithDetails.push({
            id: deal.id,
            title: deal.title,
            stage: deal.stage_name || deal.stage_id,
            status: deal.status,
            value: deal.value,
            currency: deal.currency,
            close_date: deal.expected_close_date,
            add_time: deal.add_time,
            update_time: deal.update_time,
            won_time: deal.won_time,
            lost_time: deal.lost_time,
            latest_note: latestNote,
            pipeline: deal.pipeline_name,
            custom_fields: customFields
          });
        }

        results.push({
          id: person.id,
          name: person.name,
          email: person.emails ? person.emails[0] : null,
          phone: person.phones ? person.phones[0] : null,
          deals: dealsWithDetails
        });
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results })
      };
    }

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unknown action' })
    };

  } catch(err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
