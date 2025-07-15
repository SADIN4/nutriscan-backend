require('dotenv').config();

const express = require('express');
const Buffer = require('buffer').Buffer;
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Initialize Supabase client
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase URL ou Anon Key manquante dans les variables d\'environnement.');
  console.error('Veuillez définir EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1); // Exit if critical env vars are missing
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const SUPABASE_BUCKET = 'recipe-images';

// Helper function to store image in Supabase
async function storeImageInSupabase(recipeId, imageUrl) {
  const fileName = `recipe-${recipeId}.png`;

  try {
    console.log(`📤 Tentative de stockage de l'image DALL·E pour la recette ${recipeId} dans Supabase.`);
    console.log(`🔗 URL DALL·E source: ${imageUrl}`);

    // Enhanced fetch with User-Agent for better compatibility
    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'NutriScan-Backend/1.0 (Node.js)',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Échec du téléchargement de l'image depuis DALL·E: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    // Debug: Log response headers
    console.log(`DEBUG: DALL·E Response Headers - Content-Type: ${response.headers.get('content-type')}`);
    console.log(`DEBUG: DALL·E Response Headers - Content-Length: ${response.headers.get('content-length')}`);
    
    const arrayBuffer = await response.arrayBuffer();
    
    // Critical validation: Check if downloaded content is empty
    if (arrayBuffer.byteLength === 0) {
      throw new Error('Le téléchargement de l\'image DALL·E a renvoyé un contenu vide (0 octet).');
    }
    
    // Convert ArrayBuffer to Buffer (Node.js native binary data handling)
    const imageBuffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || 'image/png';

    console.log(`📦 Taille du Buffer de l'image: ${imageBuffer.length} octets`);
    
    // Debug: Log buffer content preview (first 64 bytes in hex)
    console.log(`DEBUG: Début de imageBuffer (hex): ${imageBuffer.toString('hex', 0, Math.min(imageBuffer.length, 64))}`);
    
    // Debug: Final check before upload
    console.log(`DEBUG: Taille de imageBuffer avant upload: ${imageBuffer.length} octets`);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(fileName, imageBuffer, {
        contentType: contentType,
        upsert: true, // Replace if exists
        cacheControl: '3600', // Cache for 1 hour
      });

    if (uploadError) {
      console.error('❌ Erreur upload Supabase:', uploadError);
      throw uploadError;
    }

    const { data: { publicUrl } } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(fileName);

    console.log(`✅ Image stockée de manière permanente dans Supabase: ${publicUrl}`);
    return { supabaseUrl: publicUrl, success: true };
    // Optional: Verify the uploaded image is accessible
    try {
      const verifyResponse = await fetch(publicUrl, { method: 'HEAD' });
      if (!verifyResponse.ok || parseInt(verifyResponse.headers.get('content-length') || '0') === 0) {
        console.warn(`⚠️ Vérification de l'image échouée ou taille 0 après upload: ${publicUrl}`);
      } else {
        console.log('✅ Vérification de l\'image post-upload réussie.');
      }
    } catch (verifyError) {
      console.warn(`⚠️ Erreur lors de la vérification de l'image post-upload: ${verifyError.message}`);
    }
    

  } catch (error) {
    console.error(`❌ Erreur lors du stockage de l'image dans Supabase pour la recette ${recipeId}:`, error);
    return { supabaseUrl: imageUrl, success: false, error: error.message }; // Fallback to original DALL·E URL
  }
}

// Helper function to get public URL from Supabase (even if not yet uploaded)
function getSupabasePublicUrl(recipeId) {
  const fileName = `recipe-${recipeId}.png`;
  const { data: { publicUrl } } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(fileName);
  return publicUrl;
}

// Fonction de génération d'image DALL·E 3
async function generateImageWithDalle({ recipeTitle, description, ingredients }) {
  try {
    console.log('🎨 Préparation image pour:', recipeTitle);

    // Construire le prompt optimisé
    let prompt = `Professional food photography of ${recipeTitle}`;
    
    if (description) {
      prompt += `, ${description}`;
    }
    
    if (ingredients && ingredients.length > 0) {
      const mainIngredients = ingredients.slice(0, 3).join(', ');
      prompt += `, featuring ${mainIngredients}`;
    }
    
    prompt += ', beautifully plated on a clean white plate, natural lighting, appetizing presentation, high resolution, professional kitchen setting';

    // Appel API DALL·E 3
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        style: 'vivid',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Erreur DALL·E:', errorData);
      throw new Error(`DALL·E API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.data || !data.data[0] || !data.data[0].url) {
      throw new Error('Aucune image générée par DALL·E');
    }

    console.log('✅ Image préparée avec succès');
    return {
      imageUrl: data.data[0].url,
      success: true
    };

  } catch (error) {
    console.error('❌ Erreur préparation image:', error);
    
    return {
      imageUrl: '',
      success: false,
      error: error.message
    };
  }
}

// Handler de génération de recette
async function handleGenerateRecipes(req, res) {
  try {
    const { image, preferences, regenerate } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Image requise' });
    }

    // Utiliser les variables d'environnement standard (sans EXPO_PUBLIC_)
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const openaiOrgId = process.env.OPENAI_ORG_ID;

    console.log('🔑 OpenAI API Key présente:', !!openaiApiKey);
    console.log('🏢 OpenAI Org ID présent:', !!openaiOrgId);

    if (!openaiApiKey) {
      console.error('❌ Clé API OpenAI manquante dans les variables d\'environnement');
      return res.status(503).json({ error: 'Clé API OpenAI manquante' });
    }

    console.log("🍳 Préparation de votre recette personnalisée...");
    const startTime = Date.now();

    let promptText = `Analysez cette image et créez UNE recette ${regenerate ? 'DIFFÉRENTE et CRÉATIVE' : 'parfaite'} en utilisant UNIQUEMENT les ingrédients visibles.

EXIGENCES STRICTES:
- Identifiez UNIQUEMENT les ingrédients clairement visibles
- Créez UNE recette ${regenerate ? 'NOUVELLE et ORIGINALE' : 'exceptionnelle'} utilisant ces ingrédients
- ${regenerate ? 'VARIEZ l\'approche culinaire et les techniques de cuisson' : 'Optimisez pour la saveur et la simplicité'}
- Ajoutez seulement des ingrédients de base (sel, poivre, huile) si nécessaire
- RÉPONDEZ ENTIÈREMENT EN FRANÇAIS
- Soyez CONCIS et DIRECT`;

    // Add meal type preferences
    if (preferences?.mealType) {
      promptText += `\n- Adaptez pour ${preferences.mealType}`;
    }

    // Add dietary preferences
    if (preferences?.dietaryPreferences) {
      promptText += `\n- RESPECTEZ STRICTEMENT: ${preferences.dietaryPreferences}`;
    }

    // Add regeneration-specific instructions
    if (regenerate) {
      promptText += `\n- IMPORTANT: Créez une recette COMPLÈTEMENT DIFFÉRENTE
- Explorez des techniques alternatives (grillé vs sauté vs cuit au four)
- Variez les styles culinaires (méditerranéen, asiatique, français, etc.)`;
    }

    promptText += `\n\nRÉPONDEZ AVEC SEULEMENT CE JSON EN FRANÇAIS:

{
  "identifiedIngredients": ["ingrédient1", "ingrédient2"],
  "recipe": {
    "title": "Nom spécifique et appétissant de la recette",
    "description": "Description courte et engageante (2-3 phrases)",
    "prepTime": "X min",
    "cookTime": "X min",
    "difficulty": "Facile|Moyen|Difficile",
    "servings": nombre,
    "calories": nombre,
    "ingredients": ["quantités précises avec ingrédients identifiés"],
    "instructions": ["étape détaillée 1", "étape détaillée 2", "étape détaillée 3"],
    "tags": ["cuisine", "méthode"${preferences?.mealType ? `, "${preferences.mealType}"` : ''}]
  }
}

OBJECTIFS CALORIQUES:
- Petit-déjeuner: 300-400
- Déjeuner: 450-550  
- Dîner: 550-700
- Collation: 200-300

Créez une recette ${regenerate ? 'innovante et surprenante' : 'unique, délicieuse et réalisable'} !`;

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
          ...(openaiOrgId && { 'OpenAI-Organization': openaiOrgId }),
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                { type: 'image_url', image_url: { url: image } }
              ]
            }
          ],
          max_tokens: 1000,
          temperature: regenerate ? 0.9 : 0.7,
        }),
      });
    } catch (networkError) {
      console.error('Network error calling OpenAI API:', networkError);
      return res.status(503).json({ error: 'Impossible de se connecter au service. Vérifiez votre connexion internet et réessayez.' });
    }

    console.log("📡 Analyse nutritionnelle en cours...");

    if (!response.ok) {
      let errorMessage = 'Échec de la préparation de recette';
      let errorDetails = '';
      
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error.message || errorData.error;
          errorDetails = `Erreur service (${response.status}): ${errorMessage}`;
          
          if (response.status === 401) {
            errorDetails = 'Service temporairement indisponible. Veuillez réessayer.';
          } else if (response.status === 429) {
            errorDetails = 'Service surchargé. Veuillez réessayer dans quelques minutes.';
          } else if (response.status === 400) {
            errorDetails = `Erreur de traitement: ${errorMessage}`;
          }
        }
      } catch (parseError) {
        const errorText = await response.text();
        errorDetails = `Erreur service (${response.status}): ${errorText}`;
      }
      
      console.error('Erreur service:', errorDetails);
      return res.status(response.status).json({ error: errorDetails });
    }

    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      const rawResponse = await response.text();
      console.error('Échec de l\'analyse de la réponse:', jsonError);
      console.error('Réponse brute:', rawResponse);
      return res.status(500).json({ error: 'Erreur de traitement des données. Veuillez réessayer.' });
    }

    const content = data.choices[0]?.message?.content;

    if (!content) {
      return res.status(500).json({ error: 'Aucune recette générée. Veuillez réessayer.' });
    }

    // Parse the OpenAI response
    let parsedResponse;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        parsedResponse = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('Échec de l\'analyse de la réponse:', parseError);
      console.error('Contenu:', content);
      return res.status(500).json({ error: 'Erreur de traitement des données de recette. Veuillez réessayer.' });
    }

    // Validate response structure
    if (!parsedResponse.identifiedIngredients || !parsedResponse.recipe) {
      console.error('Structure de réponse invalide:', parsedResponse);
      return res.status(500).json({ error: 'Données de recette incomplètes. Veuillez réessayer.' });
    }

    // Validate and add default calories if missing
    if (!parsedResponse.recipe.calories || typeof parsedResponse.recipe.calories !== 'number') {
      let estimatedCalories = 400;
      
      if (preferences?.mealType) {
        switch (preferences.mealType.toLowerCase()) {
          case 'breakfast':
          case 'petit-déjeuner':
            estimatedCalories = 350;
            break;
          case 'lunch':
          case 'déjeuner':
            estimatedCalories = 500;
            break;
          case 'dinner':
          case 'dîner':
            estimatedCalories = 625;
            break;
          case 'snack':
          case 'collation':
            estimatedCalories = 250;
            break;
        }
      }
      
      parsedResponse.recipe.calories = estimatedCalories;
    }

    console.log("✅ Recette préparée avec succès:", parsedResponse.recipe.title);
    console.log("🥕 Ingrédients identifiés:", parsedResponse.identifiedIngredients);
    console.log("🔥 Calories de la recette:", parsedResponse.recipe.calories);

    // 🎨 IMAGE PREPARATION - Start immediately after recipe is ready
    console.log("🎨 Préparation de l'image de la recette avec DALL·E 3...");
    
    const recipeId = `recipe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Générer l'image avec DALL·E 3
    const dalleResult = await generateImageWithDalle({
      recipeTitle: parsedResponse.recipe.title,
      description: parsedResponse.recipe.description,
      ingredients: parsedResponse.identifiedIngredients
    });
    
    let finalImageUrl = dalleResult.imageUrl;
    
    if (dalleResult.success) {
      console.log("✅ Image de recette préparée avec succès");
      
      // Store the image in Supabase and get permanent URL
      const storageResult = await storeImageInSupabase(recipeId, dalleResult.imageUrl);
      if (storageResult.success) {
        finalImageUrl = storageResult.supabaseUrl;
        console.log("✅ Image stockée définitivement dans Supabase:", finalImageUrl);
      } else {
        console.log("⚠️ Utilisation de l'URL DALL·E en fallback car le stockage Supabase a échoué:", storageResult.error);
      }
    } else {
      console.log("⚠️ Échec préparation image:", dalleResult.error);
    }

    // Ajouter l'image URL à la recette
    const finalRecipe = {
      ...parsedResponse.recipe,
      imageUrl: finalImageUrl,
      id: recipeId,
      imageSource: dalleResult.success ? (finalImageUrl.includes('supabase') ? 'supabase' : 'dalle') : 'failed'
    };

    const endTime = Date.now();
    console.log(`⚡ Préparation complète terminée en ${endTime - startTime}ms`);
    console.log("🎯 Préférences appliquées:", preferences);
    console.log("🖼️ Image de recette finale:", finalImageUrl);
    console.log("⚡ Préparation complète terminée");
    
    if (regenerate) {
      console.log("🔄 Nouvelle recette préparée avec succès");
    }
    
    return res.json({ 
      recipe: finalRecipe,
      identifiedIngredients: parsedResponse.identifiedIngredients,
      imageGenerationSuccess: dalleResult.success && finalImageUrl.includes('supabase'),
      generationTime: endTime - startTime
    });

  } catch (error) {
    console.error('❌ Erreur lors de la préparation:', error);
    res.status(500).json({ 
      error: 'Erreur interne du serveur',
      details: error.message 
    });
  }
}

// Handler pour la génération d'image seule
async function handleGenerateImage(req, res) {
  try {
    const { recipeTitle, description, ingredients, recipeId } = req.body;
    
    if (!recipeTitle || !recipeId) {
      return res.status(400).json({ error: 'Titre de recette et ID requis' });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;

    if (!openaiApiKey) {
      console.error('❌ Clé API OpenAI manquante');
      return res.status(503).json({ error: 'Service de préparation d\'images indisponible' });
    }

    console.log("🎨 Préparation d'image pour:", recipeTitle);
    
    // Générer l'image avec DALL·E 3
    const dalleResult = await generateImageWithDalle({
      recipeTitle,
      description,
      ingredients,
      style: 'food-photography',
      size: '1024x1024'
    });
    
    if (dalleResult.success) {
      console.log("✅ Image préparée avec succès");
      
      // Store the image in Supabase and get permanent URL
      const storageResult = await storeImageInSupabase(recipeId, dalleResult.imageUrl);
      const finalImageUrl = storageResult.success ? storageResult.supabaseUrl : dalleResult.imageUrl;
      
      return res.json({ 
        success: true,
        imageUrl: finalImageUrl,
        storedInSupabase: storageResult.success
      });
    } else {
      console.log("❌ Échec préparation image:", dalleResult.error);
      
      return res.status(500).json({
        success: false,
        error: dalleResult.error || 'Échec de la préparation d\'image'
      });
    }

  } catch (error) {
    console.error('❌ Erreur préparation image:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erreur interne du serveur',
      details: error.message 
    });
  }
}

// Route d'API
app.post('/api/generate-recipes', handleGenerateRecipes);
app.post('/api/generate-image', handleGenerateImage);

// Route de test pour vérifier que le serveur fonctionne
app.get('/', (req, res) => {
  res.json({ 
    message: 'Serveur NutriScan API en fonctionnement',
    timestamp: new Date().toISOString(),
    endpoints: ['/api/generate-recipes', '/api/generate-image'],
    features: ['Préparation de recettes personnalisées', 'Préparation d\'images de recettes']
  });
});

// Démarrage du serveur
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Serveur API en écoute sur http://0.0.0.0:${port}`);
  console.log(`🌐 Accessible via: http://localhost:${port}`);
  console.log(`🔑 Variables d'environnement chargées:`);
  console.log(`   - EXPO_PUBLIC_SUPABASE_URL: ${process.env.EXPO_PUBLIC_SUPABASE_URL ? 'Présente' : 'Manquante'}`);
  console.log(`   - EXPO_PUBLIC_SUPABASE_ANON_KEY: ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ? 'Présente' : 'Manquante'}`);
  console.log(`   - OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'Présente' : 'Manquante'}`);
  console.log(`   - OPENAI_ORG_ID: ${process.env.OPENAI_ORG_ID ? 'Présente' : 'Manquante'}`);
  console.log(`🎨 Préparation d'images activée`);
});
