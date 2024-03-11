import discord
from discord.ext import commands
import yaml
import asyncio
import datetime

# Load configuration from config.yml
with open('config.yml', 'r') as file:
    config = yaml.safe_load(file)

intents = discord.Intents.default()
intents.members = True
bot = commands.Bot(command_prefix=config['prefix'], intents=intents)

# Game variables
game_started = False
game_end_time = None
teams = {}
assassinations = {}
disputes = {}

# Helper functions
def is_game_manager(ctx):
    return ctx.author.id == config['game_manager_id']

def create_team_embed(team_name, team_members):
    embed = discord.Embed(title=f"Team: {team_name}", color=discord.Color.blue())
    embed.add_field(name="Members", value="\n".join([f"<@{member}>" for member in team_members]))
    return embed

def create_leaderboard_embed():
    leaderboard = sorted(teams.items(), key=lambda x: len(x[1]['eliminations']), reverse=True)
    embed = discord.Embed(title="Leaderboard", color=discord.Color.green())
    for team_name, team_info in leaderboard:
        if not team_info['eliminated']:
            embed.add_field(name=team_name, value=f"Eliminations: {len(team_info['eliminations'])}", inline=False)
    return embed

def create_dispute_embed(dispute_id, dispute_info):
    embed = discord.Embed(title=f"Dispute #{dispute_id}", color=discord.Color.red())
    embed.add_field(name="Submitted by", value=f"<@{dispute_info['submitter']}>", inline=False)
    embed.add_field(name="Description", value=dispute_info['description'], inline=False)
    return embed

# Bot events
@bot.event
async def on_ready():
    print(f"Bot is ready. Logged in as {bot.user.name}")

    # Set up channels
    global leaderboard_channel, status_channel, assassination_channel, dispute_channel
    leaderboard_channel = bot.get_channel(config['leaderboard_channel_id'])
    status_channel = bot.get_channel(config['status_channel_id'])
    assassination_channel = bot.get_channel(config['assassination_channel_id'])
    dispute_channel = bot.get_channel(config['dispute_channel_id'])

    # Clear channels on bot startup
    await leaderboard_channel.purge()
    await status_channel.purge()
    await assassination_channel.purge()
    await dispute_channel.purge()

# Bot commands
@bot.command()
@commands.check(is_game_manager)
async def start(ctx, duration: int):
    global game_started, game_end_time
    if not game_started:
        game_started = True
        game_end_time = datetime.datetime.now() + datetime.timedelta(minutes=duration)
        await ctx.send(f"Game started! It will end at {game_end_time}.")
    else:
        await ctx.send("A game is already in progress.")

@bot.command()
async def join(ctx):
    if game_started:
        if ctx.author.id not in [member for team in teams.values() for member in team['members']]:
            await ctx.author.send("Do you want to create a new team or join an existing team? (create/join)")

            def check(msg):
                return msg.author == ctx.author and msg.channel == ctx.author.dm_channel

            try:
                response = await bot.wait_for('message', check=check, timeout=30)
                if response.content.lower() == 'create':
                    await ctx.author.send("Enter a name for your team:")
                    team_name = await bot.wait_for('message', check=check, timeout=30)
                    teams[team_name.content] = {'members': [ctx.author.id], 'owner': ctx.author.id, 'eliminations': [], 'eliminated': False}
                    await ctx.author.send(f"Team '{team_name.content}' created successfully!")
                elif response.content.lower() == 'join':
                    if teams:
                        team_names = "\n".join([f"{i+1}. {team_name}" for i, team_name in enumerate(teams)])
                        await ctx.author.send(f"Available teams:\n{team_names}\n\nEnter the number of the team you want to join:")
                        team_index = await bot.wait_for('message', check=check, timeout=30)
                        if team_index.content.isdigit() and 1 <= int(team_index.content) <= len(teams):
                            selected_team = list(teams.keys())[int(team_index.content) - 1]
                            await ctx.send(f"<@{teams[selected_team]['owner']}>, <@{ctx.author.id}> wants to join your team. Do you approve? (yes/no)")

                            def owner_check(msg):
                                return msg.author.id == teams[selected_team]['owner'] and msg.channel == ctx.channel

                            try:
                                owner_response = await bot.wait_for('message', check=owner_check, timeout=86400)
                                if owner_response.content.lower() == 'yes':
                                    teams[selected_team]['members'].append(ctx.author.id)
                                    await ctx.author.send(f"You have joined team '{selected_team}'!")
                                else:
                                    await ctx.author.send("Your request to join the team was denied.")
                            except asyncio.TimeoutError:
                                await ctx.author.send("The team owner did not respond within 24 hours. Please try again.")
                        else:
                            await ctx.author.send("Invalid team number.")
                    else:
                        await ctx.author.send("No teams available to join at the moment.")
                else:
                    await ctx.author.send("Invalid response. Please try again.")
            except asyncio.TimeoutError:
                await ctx.author.send("Timed out. Please try again.")
        else:
            await ctx.send("You are already in a team.")
    else:
        await ctx.send("No game is currently in progress.")

@bot.command()
async def leave(ctx):
    if game_started:
        for team_name, team_info in teams.items():
            if ctx.author.id in team_info['members']:
                team_info['members'].remove(ctx.author.id)
                if ctx.author.id == team_info['owner']:
                    if team_info['members']:
                        team_info['owner'] = team_info['members'][0]
                        await ctx.send(f"<@{team_info['owner']}> is now the owner of team '{team_name}'.")
                    else:
                        del teams[team_name]
                        await ctx.send(f"Team '{team_name}' has been disbanded as all members have left.")
                else:
                    await ctx.send(f"You have left team '{team_name}'.")
                break
        else:
            await ctx.send("You are not currently in a team.")
    else:
        await ctx.send("No game is currently in progress.")

@bot.command()
async def status(ctx):
    if game_started:
        if teams:
            for team_name, team_info in teams.items():
                await status_channel.send(embed=create_team_embed(team_name, team_info['members']))
        else:
            await status_channel.send("No teams have been formed yet.")
    else:
        await ctx.send("No game is currently in progress.")

@bot.command()
async def leaderboard(ctx):
    if game_started:
        if teams:
            await leaderboard_channel.purge()
            await leaderboard_channel.send(embed=create_leaderboard_embed())
        else:
            await leaderboard_channel.send("No teams have been formed yet.")
    else:
        await ctx.send("No game is currently in progress.")

@bot.command()
async def assassinate(ctx, target: discord.Member):
    if game_started:
        assassin_team = None
        target_team = None
        for team_name, team_info in teams.items():
            if ctx.author.id in team_info['members']:
                assassin_team = team_name
            if target.id in team_info['members']:
                target_team = team_name

        if assassin_team and target_team:
            if assassin_team != target_team:
                if not teams[target_team]['eliminated']:
                    await ctx.send("Please provide an image as proof of the assassination.")

                    def check(msg):
                        return msg.author == ctx.author and msg.channel == ctx.channel and len(msg.attachments) > 0

                    try:
                        assassination_proof = await bot.wait_for('message', check=check, timeout=60)
                        assassination_id = len(assassinations) + 1
                        assassinations[assassination_id] = {'assassin': ctx.author.id, 'target': target.id, 'team': target_team, 'proof': assassination_proof.attachments[0].url, 'votes': []}

                        assassination_embed = discord.Embed(title=f"Assassination #{assassination_id}", color=discord.Color.orange())
                        assassination_embed.set_image(url=assassination_proof.attachments[0].url)
                        assassination_embed.add_field(name="Assassin", value=f"<@{ctx.author.id}>", inline=True)
                        assassination_embed.add_field(name="Target", value=f"<@{target.id}>", inline=True)
                        assassination_message = await assassination_channel.send(embed=assassination_embed)

                        await assassination_message.add_reaction('✅')
                        await assassination_message.add_reaction('❌')

                        await asyncio.sleep(config['voting_duration'])

                        assassination_message = await assassination_channel.fetch_message(assassination_message.id)
                        upvotes = 0
                        downvotes = 0
                        for reaction in assassination_message.reactions:
                            if str(reaction.emoji) == '✅':
                                upvotes = reaction.count - 1
                            elif str(reaction.emoji) == '❌':
                                downvotes = reaction.count - 1

                        total_votes = upvotes + downvotes
                        if total_votes > 0:
                            if upvotes > downvotes:
                                teams[target_team]['members'].remove(target.id)
                                if not teams[target_team]['members']:
                                    teams[target_team]['eliminated'] = True
                                    await status_channel.send(f"Team '{target_team}' has been eliminated!")
                                    del assassinations[assassination_id]
                                    # Assign new targets to the assassin team
                                    alive_teams = [team for team in teams.values() if not team['eliminated']]
                                    if len(alive_teams) > 1:
                                        new_target_team = None
                                        while not new_target_team:
                                            potential_target = random.choice(alive_teams)
                                            if potential_target != teams[assassin_team]:
                                                new_target_team = potential_target
                                        teams[assassin_team]['target'] = new_target_team['members'][0]
                                        await status_channel.send(f"Team '{assassin_team}' has been assigned a new target: <@{teams[assassin_team]['target']}>")
                                    elif len(alive_teams) == 1:
                                        await status_channel.send(f"Team '{alive_teams[0]}' is the last team standing and wins the game!")
                                        game_started = False
                                else:
                                    await status_channel.send(f"Assassination confirmed. <@{target.id}> has been eliminated from team '{target_team}'.")
                                await leaderboard_channel.purge()
                                await leaderboard_channel.send(embed=create_leaderboard_embed())
                            else:
                                await assassination_channel.send("Assassination rejected. Insufficient votes.")
                        else:
                            await assassination_channel.send("No votes were cast. Assassination rejected.")

                    except asyncio.TimeoutError:
                        await ctx.send("No assassination proof provided within the time limit. Assassination cancelled.")
                else:
                    await ctx.send("The target team has already been eliminated.")
            else:
                await ctx.send("You cannot assassinate a member of your own team.")
        else:
            await ctx.send("Either you or the target are not part of a team.")
    else:
        await ctx.send("No game is currently in progress.")

@bot.command()
async def dispute(ctx, *, description: str):
    if game_started:
        dispute_id = len(disputes) + 1
        disputes[dispute_id] = {'submitter': ctx.author.id, 'description': description}
        await ctx.send(f"Dispute #{dispute_id} submitted. It will be reviewed by the game manager.")
        game_manager = await bot.fetch_user(config['game_manager_id'])
        await dispute_channel.send(embed=create_dispute_embed(dispute_id, disputes[dispute_id]))
    else:
        await ctx.send("No game is currently in progress.")

@bot.command()
@commands.check(is_game_manager)
async def resolve(ctx, dispute_id: int, resolution: str):
    if game_started:
        if dispute_id in disputes:
            dispute_info = disputes[dispute_id]
            await dispute_channel.send(f"Dispute #{dispute_id} resolved: {resolution}")
            submitter = await bot.fetch_user(dispute_info['submitter'])
            await submitter.send(f"Your dispute (ID: {dispute_id}) has been resolved: {resolution}")
            del disputes[dispute_id]
        else:
            await ctx.send(f"Dispute #{dispute_id} not found.")
    else:
        await ctx.send("No game is currently in progress.")

@bot.command()
@commands.check(is_game_manager)
async def disqualify(ctx, member: discord.Member):
    if game_started:
        for team_name, team_info in teams.items():
            if member.id in team_info['members']:
                team_info['members'].remove(member.id)
                await ctx.send(f"<@{member.id}> has been disqualified from team '{team_name}'.")
                if not team_info['members']:
                    del teams[team_name]
                    await status_channel.send(f"Team '{team_name}' has been disqualified as all members have been disqualified.")
                    await leaderboard_channel.purge()
                    await leaderboard_channel.send(embed=create_leaderboard_embed())
                break
        else:
            await ctx.send("The specified member is not part of any team.")
    else:
        await ctx.send("No game is currently in progress.")

# Run the bot
bot.run(config['token'])
