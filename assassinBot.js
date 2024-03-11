const Discord = require('discord.js');
const yaml = require('js-yaml');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');

// Read the configuration file
const config = yaml.load(fs.readFileSync('config.yml', 'utf8'));

// Set up the database connection
const sequelize = new Sequelize({
  dialect: config.database.dialect,
  storage: config.database.storage,
});

// Define the models
const Player = sequelize.define('Player', {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    teamId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    joinDate: {
      type: DataTypes.DATE,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
  });
  
  const Team = sequelize.define('Team', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    ownerId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    joinDate: {
      type: DataTypes.DATE,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
  });
  
  const GameState = sequelize.define('GameState', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    state: {
      type: DataTypes.ENUM('lobby', 'active', 'ended'),
      defaultValue: 'lobby',
    },
  });
  
  const TargetAssignment = sequelize.define('TargetAssignment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    gameId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    assassinTeamId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    targetTeamId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  });

  const Assassination = sequelize.define('Assassination', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    gameId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    assassinTeamId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    targetTeamId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
  });

const AssassinationAttempt = sequelize.define('AssassinationAttempt', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  gameId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  assassinTeamId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  evidenceUrl: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
});

// Define associations
Player.belongsTo(Team, { foreignKey: 'teamId' });
Team.hasMany(Player, { foreignKey: 'teamId' });

// Set up the Discord client
const client = new Discord.Client({
  intents: [Discord.Intents.FLAGS.GUILDS, Discord.Intents.FLAGS.GUILD_MESSAGES],
});

// Event listener for when the bot is ready
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Event listener for handling commands
client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isButton() && !interaction.isCommand()) return;
  
      const player = await Player.findOne({ where: { id: interaction.user.id } });
  
      if (interaction.customId === 'create_team') {
        if (!player) {
          // Player is not registered, prompt them to register first
          await interaction.reply('You need to register first before creating a team.');
          return;
        }
  
        // Prompt the player to enter a team name
        await interaction.reply('Please enter a team name:');
        const filter = (m) => m.author.id === interaction.user.id;
        const collector = interaction.channel.createMessageCollector({ filter, max: 1, time: config.game.team_creation_timeout });
  
        collector.on('collect', async (message) => {
          const teamName = message.content;
          const existingTeam = await Team.findOne({ where: { name: teamName } });
          if (existingTeam) {
            await interaction.followUp('A team with that name already exists. Please choose a different name.');
          } else {
            const newTeam = await Team.create({ name: teamName, ownerId: interaction.user.id });
            await player.update({ teamId: newTeam.id });
            await interaction.followUp(`Team "${teamName}" has been created successfully.`);
          }
        });
  
        collector.on('end', async (collected, reason) => {
          if (reason === 'time') {
            await interaction.followUp('Team creation timed out. Please try again.');
          }
        });
      } else if (interaction.customId === 'join_team') {
        if (!player) {
          // Player is not registered, prompt them to register first
          await interaction.reply('You need to register first before joining a team.');
          return;
        }
  
        // Fetch the list of available teams
        const teams = await Team.findAll();
        if (teams.length === 0) {
          await interaction.reply('There are no teams available to join at the moment.');
          return;
        }
  
        const teamOptions = teams.map((team) => ({
          label: team.name,
          value: team.id.toString(),
        }));
  
        const row = new Discord.MessageActionRow().addComponents(
          new Discord.MessageSelectMenu()
            .setCustomId('team_select')
            .setPlaceholder('Select a team to join')
            .addOptions(teamOptions)
        );
  
        await interaction.reply({ content: 'Please select a team to join:', components: [row] });
      } else if (interaction.customId === 'team_select') {
        const selectedTeamId = interaction.values[0];
        const selectedTeam = await Team.findOne({ where: { id: selectedTeamId } });
        if (!selectedTeam) {
          await interaction.reply('The selected team does not exist anymore.');
          return;
        }
  
        // Send a join request to the team owner
        const owner = await client.users.fetch(selectedTeam.ownerId);
        const joinEmbed = new Discord.MessageEmbed()
          .setTitle('Team Join Request')
          .setDescription(`${interaction.user.username} has requested to join your team "${selectedTeam.name}".`)
          .setFooter('This request will expire in 24 hours.');
  
        const joinRow = new Discord.MessageActionRow().addComponents(
          new Discord.MessageButton()
            .setCustomId('approve_join')
            .setLabel('Approve')
            .setStyle('SUCCESS'),
          new Discord.MessageButton()
            .setCustomId('reject_join')
            .setLabel('Reject')
            .setStyle('DANGER')
        );
  
        const joinMessage = await owner.send({ embeds: [joinEmbed], components: [joinRow] });
  
        const filter = (i) => i.customId === 'approve_join' || i.customId === 'reject_join';
        const collector = joinMessage.createMessageComponentCollector({ filter, max: 1, time: config.game.join_request_timeout });
  
        collector.on('collect', async (i) => {
          if (i.customId === 'approve_join') {
            await player.update({ teamId: selectedTeam.id });
            await interaction.followUp(`Your join request for team "${selectedTeam.name}" has been approved.`);
            await i.update({ content: 'Join request approved.', components: [] });
          } else if (i.customId === 'reject_join') {
            await interaction.followUp(`Your join request for team "${selectedTeam.name}" has been rejected.`);
            await i.update({ content: 'Join request rejected.', components: [] });
          }
        });
  
        collector.on('end', async (collected, reason) => {
          if (reason === 'time') {
            await interaction.followUp(`Your join request for team "${selectedTeam.name}" has expired.`);
            await joinMessage.edit({ content: 'Join request expired.', components: [] });
          }
        });
      } else if (interaction.customId === 'start_game') {
        // Check if the user has the game manager role
        const gameManagerRole = interaction.guild.roles.cache.get(config.game_manager.role_id);
        if (!interaction.member.roles.cache.has(gameManagerRole.id)) {
          await interaction.reply('Only game managers can start the game.');
          return;
        }
  
        // Check if the game is already active
        const gameState = await GameState.findOne();
        if (gameState.state === 'active') {
          await interaction.reply('The game is already active.');
          return;
        }
  
        // Update the game state to active
        await gameState.update({ state: 'active' });
  
        // Assign initial targets
        await assignTargets();
  
        logEvent('Game Started', `Game ID: ${gameState.id}`);
  
        await interaction.reply('The game has been started and initial targets have been assigned!');
      } else if (interaction.customId === 'end_game') {
        // Check if the user has the game manager role
        const gameManagerRole = interaction.guild.roles.cache.get(config.game_manager.role_id);
        if (!interaction.member.roles.cache.has(gameManagerRole.id)) {
          await interaction.reply('Only game managers can end the game.');
          return;
        }
  
        // Check if the game is already ended
        const gameState = await GameState.findOne();
        if (gameState.state === 'ended') {
          await interaction.reply('The game has already ended.');
          return;
        }
  
        // Update the game state to ended
        await gameState.update({ state: 'ended' });
  
        logEvent('Game Ended', `Game ID: ${gameState.id}`);
  
        await interaction.reply('The game has been ended!');
      } else if (interaction.customId === 'report_assassination') {
        // Check if the player is in an active team
        const player = await Player.findOne({ where: { id: interaction.user.id } });
        if (!player || !player.teamId) {
          await interaction.reply('You must be in an active team to report an assassination.');
          return;
        }
  
        // Check if the game is in the active state
        const gameState = await GameState.findOne();
        if (gameState.state !== 'active') {
          await interaction.reply('Assassinations can only be reported during an active game.');
          return;
        }
  
        // Prompt the player to provide evidence and description
        const evidenceModal = new Discord.Modal()
          .setCustomId('assassination_evidence')
          .setTitle('Assassination Evidence')
          .addComponents(
            new Discord.MessageActionRow().addComponents(
              new Discord.TextInputComponent()
                .setCustomId('evidence_url')
                .setLabel('Evidence URL')
                .setStyle('SHORT')
                .setPlaceholder('Enter the URL of the evidence image')
                .setRequired(true)
            ),
            new Discord.MessageActionRow().addComponents(
              new Discord.TextInputComponent()
                .setCustomId('description')
                .setLabel('Description')
                .setStyle('PARAGRAPH')
                .setPlaceholder('Describe the assassination attempt')
                .setRequired(true)
            )
          );
  
        await interaction.showModal(evidenceModal);
      } else if (interaction.customId === 'assassination_evidence') {
        const evidenceUrl = interaction.fields.getTextInputValue('evidence_url');
        const description = interaction.fields.getTextInputValue('description');
  
        // Store the reported assassination attempt in the database
        const assassinationAttempt = await AssassinationAttempt.create({
          gameId: gameState.id,
          assassinTeamId: player.teamId,
          evidenceUrl: evidenceUrl,
          description: description,
        });
  
        logEvent('Assassination Attempt Reported', `Attempt ID: ${assassinationAttempt.id}`);
  
        await interaction.reply('Assassination attempt reported successfully!');
  
        // Send a notification to the game managers' channel
        const gameManagerChannel = interaction.guild.channels.cache.get(config.game_manager.channel_id);
        const attemptEmbed = new Discord.MessageEmbed()
          .setTitle('New Assassination Attempt')
          .setDescription(`Assassin Team: ${player.team.name}\nEvidence: ${evidenceUrl}\nDescription: ${description}`)
          .setFooter(`Attempt ID: ${assassinationAttempt.id}`);
  
        const validationRow = new Discord.MessageActionRow().addComponents(
          new Discord.MessageButton()
            .setCustomId('validate_attempt')
            .setLabel('Validate')   
            .setStyle('SUCCESS'),
          new Discord.MessageButton()
            .setCustomId('reject_attempt')
            .setLabel('Reject')
            .setStyle('DANGER')
        );
  
        await gameManagerChannel.send({ embeds: [attemptEmbed], components: [validationRow] });
      } else if (interaction.customId === 'validate_attempt' || interaction.customId === 'reject_attempt') {
        // Check if the user has the game manager role
        const gameManagerRole = interaction.guild.roles.cache.get(config.game_manager.role_id);
        if (!interaction.member.roles.cache.has(gameManagerRole.id)) {
          await interaction.reply('Only game managers can validate assassination attempts.');
          return;
        }
  
        const attemptId = interaction.message.embeds[0].footer.text.split(':')[1].trim();
        const attempt = await AssassinationAttempt.findOne({ where: { id: attemptId } });
  
        if (!attempt) {
          await interaction.reply('Invalid assassination attempt.');
          return;
        }
  
        if (interaction.customId === 'validate_attempt') {
          // Update the game state and player/team status
          const assassinTeam = await Team.findOne({ where: { id: attempt.assassinTeamId } });
          const targetTeam = await Team.findOne({ where: { id: assassinTeam.targetTeamId } });
  
          await targetTeam.update({ isActive: false });
          await Player.update({ isActive: false }, { where: { teamId: targetTeam.id } });
  
          await Assassination.create({
            gameId: attempt.gameId,
            assassinTeamId: assassinTeam.id,
            targetTeamId: targetTeam.id,
          });
  
          await attempt.destroy();
  
          logEvent('Assassination Attempt Validated', `Attempt ID: ${attempt.id}`);
  
          await interaction.update({ content: 'Assassination attempt validated!', components: [] });
  
          // Assign new targets
          await assignTargets();
  
          // Update the leaderboard message
          const leaderboardMessage = await gameManagerChannel.messages.fetch(config.game_manager.leaderboard_message_id);
          const updatedLeaderboardEmbed = await generateLeaderboardEmbed();
          await leaderboardMessage.edit({ embeds: [updatedLeaderboardEmbed] });
        } else if (interaction.customId === 'reject_attempt') {
          await attempt.destroy();
  
          logEvent('Assassination Attempt Rejected', `Attempt ID: ${attempt.id}`);
  
          await interaction.update({ content: 'Assassination attempt rejected.', components: [] });
        }
      } else if (interaction.commandName === 'leaderboard') {
        // Check if the game is in the active state
        const gameState = await GameState.findOne();
        if (gameState.state !== 'active') {
          await interaction.reply('The leaderboard is only available during an active game.');
          return;
        }
  
        const leaderboardEmbed = await generateLeaderboardEmbed();
        await interaction.reply({ embeds: [leaderboardEmbed] });
      } else if (interaction.commandName === 'announce') {
        // Check if the user has the game manager role
        const gameManagerRole = interaction.guild.roles.cache.get(config.game_manager.role_id);
        if (!interaction.member.roles.cache.has(gameManagerRole.id)) {
          await interaction.reply('Only game managers can make announcements.');
          return;
        }
  
        const announcementChannel = interaction.guild.channels.cache.get(config.game.announcement_channel_id);
        const announcementMessage = interaction.options.getString('message');
  
        await announcementChannel.send(announcementMessage);
  
        logEvent('Announcement Made', `Message: ${announcementMessage}`);
  
        await interaction.reply('Announcement sent successfully!');
      }
    } catch (error) {
      console.error('Error handling interaction:', error);
      await interaction.reply('An error occurred while processing your request. Please try again later.');
    }
  });

// Event listener for handling errors
client.on('error', (error) => {
  console.error('Bot encountered an error:', error);
});

// Event listener for handling unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Function to assign targets
async function assignTargets() {
    try {
      // Check if the game is in the active state
      const gameState = await GameState.findOne();
      if (gameState.state !== 'active') {
        return;
      }
  
      // Fetch all active teams
      const teams = await Team.findAll({ where: { isActive: true } });
      if (teams.length < 2) {
        return;
      }
  
      // Clear existing target assignments
      await TargetAssignment.destroy({ where: {} });
  
      // Create a new array to store the target assignments
      const targetAssignments = [];
  
      // Assign targets based on the chain methodology
      for (let i = 0; i < teams.length; i++) {
        const assassinTeam = teams[i];
        const targetTeam = teams[(i + 1) % teams.length];
  
        // Store the target assignment in the array
        targetAssignments.push({
          gameId: gameState.id,
          assassinTeamId: assassinTeam.id,
          targetTeamId: targetTeam.id,
        });
      }
  
      // Bulk create the target assignments in the database
      await TargetAssignment.bulkCreate(targetAssignments);
  
      // Send private messages to each team with their assigned target
      for (const assignment of targetAssignments) {
        const assassinTeamMembers = await Player.findAll({ where: { teamId: assignment.assassinTeamId } });
        const targetTeam = await Team.findOne({ where: { id: assignment.targetTeamId } });
  
        for (const member of assassinTeamMembers) {
          const user = await client.users.fetch(member.id);
          await user.send(`Your team's new target is: ${targetTeam.name}`);
        }
      }
  
      // Send a global notification about target assignments
      await sendNotification(config.game.notification_channel_id, 'New targets have been assigned to all teams!');
  
      logEvent('Targets Assigned', `Game ID: ${gameState.id}`);
    } catch (error) {
      console.error('Error assigning targets:', error);
    }
}

// Function to send notifications
async function sendNotification(channelId, message) {
  const channel = await client.channels.fetch(channelId);
  await channel.send(message);
}

// Function to log important events
function logEvent(event, details) {
  console.log(`[${new Date().toISOString()}] ${event}: ${details}`);
}

// Function to generate the leaderboard embed
async function generateLeaderboardEmbed() {
    try {
      // Fetch the leaderboard data from the database
      const leaderboard = await Team.findAll({
        where: { isActive: true },
        attributes: ['name'],
        include: [
          {
            model: Assassination,
            attributes: [
              [sequelize.fn('COUNT', sequelize.col('Assassinations.id')), 'assassinationCount'],
            ],
          },
        ],
        group: ['Team.id'],
        order: [[sequelize.literal('assassinationCount'), 'DESC']],
      });
  
      // Generate the leaderboard embed
      const leaderboardEmbed = new Discord.MessageEmbed()
        .setTitle('Leaderboard')
        .setDescription('Current standings of the teams:');
  
      for (const [index, entry] of leaderboard.entries()) {
        leaderboardEmbed.addField(
          `${index + 1}. ${entry.name}`,
          `Assassinations: ${entry.Assassinations.length}`
        );
      }
  
      return leaderboardEmbed;
    } catch (error) {
      console.error('Error generating leaderboard:', error);
      return new Discord.MessageEmbed()
        .setTitle('Leaderboard')
        .setDescription('An error occurred while generating the leaderboard.');
    }
}

// Sync the database and start the bot
sequelize.sync()
  .then(() => {
    console.log('Database synced successfully.');
    client.login(config.bot.token);
  })
  .catch((error) => {
    console.error('Error syncing database:', error);
  });