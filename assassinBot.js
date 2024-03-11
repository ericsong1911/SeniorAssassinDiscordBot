import { Client, GatewayIntentBits, MessageActionRow, MessageButton, MessageEmbed, Modal } from 'discord.js';
import { TextInputComponent } from 'discord.js';
import { load } from 'js-yaml';
import { readFileSync } from 'fs';
import { Sequelize, DataTypes } from 'sequelize';

// Read the configuration file
const config = load(readFileSync('config.yml', 'utf8'));

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
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
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
  
      if (interaction.commandName === 'join') {
        // Check if the game is in the lobby state
        const gameState = await GameState.findOne();
        if (gameState.state !== 'lobby') {
          await interaction.reply('Registration is only allowed during the lobby phase.');
          return;
        }
  
        // Check if the player is already registered
        if (player) {
          await interaction.reply('You are already registered.');
          return;
        }
  
        // Prompt the player to choose between creating a team or joining an existing one
        const teamOptions = new MessageEmbed()
          .setTitle('Team Options')
          .setDescription('Please choose an option:')
          .addField('1. Create a new team', 'Select this option to create a new team.')
          .addField('2. Join an existing team', 'Select this option to join an existing team.');
  
        const teamOptionsMessage = await interaction.user.send({ embeds: [teamOptions] });
        await teamOptionsMessage.react('1️⃣');
        await teamOptionsMessage.react('2️⃣');
  
        const reactionFilter = (reaction, user) => {
          return ['1️⃣', '2️⃣'].includes(reaction.emoji.name) && user.id === interaction.user.id;
        };
  
        const teamChoice = await teamOptionsMessage.awaitReactions({ filter: reactionFilter, max: 1, time: 60000, errors: ['time'] })
          .then(collected => {
            const reaction = collected.first();
            return reaction.emoji.name;
          })
          .catch(async () => {
            await interaction.user.send('Team selection timed out. Please try again.');
            return null;
          });
  
        if (!teamChoice) {
          await interaction.reply('Registration canceled.');
          return;
        }
  
        if (teamChoice === '1️⃣') {
          // Prompt the player to enter a team name
          await interaction.user.send('Please enter a team name:');
          const messageFilter = (m) => m.author.id === interaction.user.id;
          const teamNameMessage = await interaction.user.dmChannel.awaitMessages({ filter: messageFilter, max: 1, time: 60000, errors: ['time'] })
            .then(collected => {
              return collected.first();
            })
            .catch(async () => {
              await interaction.user.send('Team name selection timed out. Please try again.');
              return null;
            });
  
          if (!teamNameMessage) {
            await interaction.reply('Registration canceled.');
            return;
          }
  
          const teamName = teamNameMessage.content;
          const existingTeam = await Team.findOne({ where: { name: teamName } });
  
          if (existingTeam) {
            await interaction.user.send('A team with that name already exists. Please choose a different name.');
            await interaction.reply('Registration failed. Team name already exists.');
            return;
          }
  
          // Create a new team and assign the player as the owner
          const newTeam = await Team.create({ name: teamName, ownerId: interaction.user.id });
          await Player.create({ id: interaction.user.id, name: interaction.user.username, teamId: newTeam.id });
          await interaction.user.send(`Team "${teamName}" has been created successfully. You are the team owner.`);
          await interaction.reply('Registration successful. Team created.');
        } else if (teamChoice === '2️⃣') {
          // Fetch the list of available teams
          const teams = await Team.findAll({ where: { isActive: true } });
          if (teams.length === 0) {
            await interaction.user.send('There are no teams available to join at the moment.');
            await interaction.reply('Registration failed. No teams available.');
            return;
          }
  
          const teamOptions = teams.map((team, index) => `${index + 1}. ${team.name}`).join('\n');
          const teamSelectionEmbed = new MessageEmbed()
            .setTitle('Team Selection')
            .setDescription(`Please select a team to join:\n\n${teamOptions}`);
  
          await interaction.user.send({ embeds: [teamSelectionEmbed] });
  
          const selectionFilter = (m) => m.author.id === interaction.user.id && !isNaN(parseInt(m.content));
          const teamSelectionMessage = await interaction.user.dmChannel.awaitMessages({ filter: selectionFilter, max: 1, time: 60000, errors: ['time'] })
            .then(collected => {
              return collected.first();
            })
            .catch(async () => {
              await interaction.user.send('Team selection timed out. Please try again.');
              return null;
            });
  
          if (!teamSelectionMessage) {
            await interaction.reply('Registration canceled.');
            return;
          }
  
          const selectedTeamIndex = parseInt(teamSelectionMessage.content) - 1;
          if (selectedTeamIndex < 0 || selectedTeamIndex >= teams.length) {
            await interaction.user.send('Invalid team selection. Please try again.');
            await interaction.reply('Registration failed. Invalid team selection.');
            return;
          }
  
          const selectedTeam = teams[selectedTeamIndex];
  
          // Send a join request to the team owner
          const owner = await client.users.fetch(selectedTeam.ownerId);
          const joinEmbed = new MessageEmbed()
            .setTitle('Team Join Request')
            .setDescription(`${interaction.user.username} has requested to join your team "${selectedTeam.name}".`)
            .setFooter('This request will expire in 24 hours.');
  
          const joinRow = new MessageActionRow().addComponents(
            new MessageButton()
              .setCustomId('approve_join')
              .setLabel('Approve')
              .setStyle('SUCCESS'),
            new MessageButton()
              .setCustomId('reject_join')
              .setLabel('Reject')
              .setStyle('DANGER')
          );
  
          const joinMessage = await owner.send({ embeds: [joinEmbed], components: [joinRow] });
  
          const buttonFilter = (i) => i.customId === 'approve_join' || i.customId === 'reject_join';
          const collector = joinMessage.createMessageComponentCollector({ filter: buttonFilter, max: 1, time: config.game.join_request_timeout });
  
          collector.on('collect', async (i) => {
            if (i.customId === 'approve_join') {
              const playerCount = await Player.count({ where: { teamId: selectedTeam.id } });
              if (playerCount >= config.game.max_players_per_team) {
                await interaction.user.send('The selected team has reached the maximum number of players.');
                await i.update({ content: 'Join request rejected. Team is full.', components: [] });
                await interaction.reply('Registration failed. Selected team is full.');
              } else {
                await Player.create({ id: interaction.user.id, name: interaction.user.username, teamId: selectedTeam.id });
                await interaction.user.send(`Your join request for team "${selectedTeam.name}" has been approved.`);
                await i.update({ content: 'Join request approved.', components: [] });
                await interaction.reply('Registration successful. Joined team.');
              }
            } else if (i.customId === 'reject_join') {
              await interaction.user.send(`Your join request for team "${selectedTeam.name}" has been rejected.`);
              await i.update({ content: 'Join request rejected.', components: [] });
              await interaction.reply('Registration failed. Join request rejected.');
            }
          });
  
          collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
              await interaction.user.send(`Your join request for team "${selectedTeam.name}" has expired.`);
              await joinMessage.edit({ content: 'Join request expired.', components: [] });
              await interaction.reply('Registration failed. Join request expired.');
            }
          });
        }
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
        const evidenceModal = new Modal()
          .setCustomId('assassination_evidence')
          .setTitle('Assassination Evidence')
          .addComponents(
            new MessageActionRow().addComponents(
              new TextInputComponent()
                .setCustomId('evidence_url')
                .setLabel('Evidence URL')
                .setStyle('SHORT')
                .setPlaceholder('Enter the URL of the evidence image')
                .setRequired(true)
            ),
            new MessageActionRow().addComponents(
              new TextInputComponent()
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
        const attemptEmbed = new MessageEmbed()
          .setTitle('New Assassination Attempt')
          .setDescription(`Assassin Team: ${player.team.name}\nEvidence: ${evidenceUrl}\nDescription: ${description}`)
          .setFooter(`Attempt ID: ${assassinationAttempt.id}`);
  
        const validationRow = new MessageActionRow().addComponents(
          new MessageButton()
            .setCustomId('validate_attempt')
            .setLabel('Validate')   
            .setStyle('SUCCESS'),
          new MessageButton()
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
      const leaderboardEmbed = new MessageEmbed()
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
      return new MessageEmbed()
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