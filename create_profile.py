import gpxpy
import gpxpy.gpx
import matplotlib.pyplot as plt
from matplotlib.widgets import Slider
from haversine import haversine, Unit
import numpy as np

# 日本語表示のためのフォント設定
try:
    plt.rcParams['font.family'] = 'MS Gothic'
    plt.rcParams['axes.unicode_minus'] = False
except Exception as e:
    print(f"フォント設定でエラーが発生しました: {e}")
    print("日本語フォントが見つからない場合、文字化けが発生する可能性があります。")

# --- 1. データ処理 ---
gpx_file_path = '20250624_2025_夏山合宿_Day3.gpx'
try:
    with open(gpx_file_path, 'r', encoding='utf-8') as gpx_file:
        gpx = gpxpy.parse(gpx_file)
except FileNotFoundError:
    print(f"エラー: ファイル '{gpx_file_path}' が見つかりません。")
    exit(1)

distances_km = []
elevations = []
total_distance_m = 0.0
previous_point = None

# ポイント間の距離と標高差を保持するリスト（勾配計算用）
segment_distances_m = []
segment_elevations_diff = []

for track in gpx.tracks:
    for segment in track.segments:
        for point in segment.points:
            if previous_point:
                distance = haversine(
                    (previous_point.latitude, previous_point.longitude),
                    (point.latitude, point.longitude),
                    unit=Unit.METERS
                )
                total_distance_m += distance
                
                segment_distances_m.append(distance)
                segment_elevations_diff.append(point.elevation - previous_point.elevation)
            
            distances_km.append(total_distance_m / 1000)
            elevations.append(point.elevation)
            previous_point = point

total_distance_km = total_distance_m / 1000
min_elev_m = min(elevations) if elevations else 0
max_elev_m = max(elevations) if elevations else 1
elev_range_m = max_elev_m - min_elev_m

# --- 勾配（傾斜角）の計算 ---
# 距離が0の区間は勾配0とする
slopes_deg = []
if segment_distances_m:
    # 区分ごとの勾配を計算 (arctan2 -> degrees)
    segment_distances_arr = np.array(segment_distances_m)
    segment_elevations_diff_arr = np.array(segment_elevations_diff)
    
    # arctan2は(y, x)の順。ラジアンを度数法に変換
    raw_slopes = np.degrees(np.arctan2(segment_elevations_diff_arr, segment_distances_arr))
    
    # ノイズ除去のための移動平均フィルタ
    window_size = 10  # 調整可能なパラメータ
    if len(raw_slopes) >= window_size:
        slopes_deg = np.convolve(raw_slopes, np.ones(window_size)/window_size, mode='same')
    else:
        slopes_deg = raw_slopes
    
    # 点の数に合わせるため、先頭に0を追加
    slopes_deg = np.insert(slopes_deg, 0, 0)
else:
    slopes_deg = [0] * len(distances_km)


# --- 2. グラフ描画 ---

# --- Figure 1: 断面図 (Elevation) ---
fig_elev, ax_elev = plt.subplots(figsize=(16, 10))
# 上部: グラフ領域 (bottom=0.45でスライダー/表のスペース確保)
fig_elev.subplots_adjust(left=0.08, right=0.95, top=0.92, bottom=0.45)
fig_elev.canvas.manager.set_window_title('断面図')

# グラフ位置を下に固定 (Box Aspect変更時に上に逃げないようにする)
# これにより、グラフの下端(bottom=0.45)が固定され、上に伸びる形になる
ax_elev.set_anchor('S')

# スライダー用のAxes (Elevation) - 位置調整
ax_slider_elev = fig_elev.add_axes([0.3, 0.05, 0.4, 0.03])

# 表用のAxes (ax_table) - グラフの下に配置
# 幅は後でupdate関数で同期させるが、初期値として適当に入れておく
# bottomは ax_elevのbottom(0.45) - table_height(0.28) - gap(0.05) = 0.12くらい
ax_table = fig_elev.add_axes([0.08, 0.12, 0.87, 0.28])
ax_table.axis('off')

ax_elev.scatter(distances_km, elevations, s=5, label='Elevation', color='blue')
ax_elev.set_ylabel('垂直距離 [m]')
# X軸ラベルは表の中に含めるため削除、または一番上の行とする
# ax_elev.set_xlabel('距離 (km)') 
ax_elev.set_title('断面図')
ax_elev.grid(True)
ax_elev.set_ylim(min_elev_m - elev_range_m * 0.1, max_elev_m + elev_range_m * 0.1)
ax_elev.set_xlim(0, total_distance_km)

# X軸の目盛り設定 (1kmごと)
x_ticks = np.arange(0, np.ceil(total_distance_km) + 1, 1.0)
ax_elev.set_xticks(x_ticks)

# --- 表の描画 (ax_table) ---
# 表の行ラベル (水平距離はX軸に表示するので表からは削除)
row_labels = ['地点間距離 [km]', '地点名 (標高 [m])', '植生']

# テーブルのデータ作成
# 横のセルはすべてつなげるため、1列だけのテーブルを作成する
cell_text = [[''] for _ in row_labels]

table = ax_table.table(
    cellText=cell_text,
    rowLabels=row_labels,
    colWidths=[1.0], # 全幅を使う
    loc='center', 
    bbox=[0, 0, 1, 1] # ax_table全体を使う
)

# テーブルのフォントサイズ調整
table.auto_set_font_size(False)
table.set_fontsize(10)

# 行ごとの高さ設定 (単位: ax_table座標系 0.0-1.0)
# 全体を1.0として、1:2:1の比率で配分
# ax_tableの高さが0.28なので、0.25倍すると0.07(1文字分)になる
row_ratios = [0.25, 0.5, 0.25] 
current_y = 1.0
for row_idx, height_ratio in enumerate(row_ratios):
    y_position = current_y - height_ratio
    
    for col_idx in [-1, 0]: # -1: 行ラベル, 0: データセル
        if (row_idx, col_idx) in table.get_celld():
            cell = table[row_idx, col_idx]
            cell.set_height(height_ratio)
            cell.set_y(y_position)
            
            # 行ラベルの枠線削除
            if col_idx == -1:
                cell.set_linewidth(0)
    
    current_y -= height_ratio

# "水平距離 [km]" のラベル - これはX軸(ax_elev)に関連付くのでax_elevに残す
# 位置調整
ax_elev.text(-0.01, -0.06, '水平距離 [km]', transform=ax_elev.transAxes, 
             fontsize=10, verticalalignment='center', horizontalalignment='right')

# --- Y軸の省略記号 (0スタートでない場合) ---
y_min, y_max = ax_elev.get_ylim()
if y_min > 100: # 100m以上浮いている場合は省略記号を入れる
    # 省略記号 (波線)
    # Axes座標系で左下(0,0)の少し上あたりに描画
    break_y = 0.01 # 軸の下端付近
    kwargs = dict(transform=ax_elev.transAxes, color='k', clip_on=False)
    
    # 波線 (~)
    # Y軸(x=0)を横切るように波を描く
    d = 0.015 # 幅
    amp = 0.003 # 振幅
    x_wave = np.linspace(-d, d, 50)
    # y = break_y + amp * sin(...)
    # 2周期分くらいの波
    y_wave1 = break_y + amp * np.sin(np.linspace(0, 4*np.pi, 50))
    y_wave2 = break_y+0.01 + amp * np.sin(np.linspace(0, 4*np.pi, 50))
    
    ax_elev.plot(x_wave, y_wave1, **kwargs)
    ax_elev.plot(x_wave, y_wave2, **kwargs)

    # 0のラベル
    # 波線の下に配置
    ax_elev.text(-0.015, break_y - 0.01, '0', transform=ax_elev.transAxes,
                 fontsize=10, verticalalignment='top', horizontalalignment='right')

# セルの高さを調整するためのループ（必要であれば）
# for key, cell in table.get_celld().items():
#     cell.set_height(0.1)

# テキスト情報を表示 (Elevation)
total_dist_text = f"総距離: {total_distance_km:.2f} km"
ratio_text_elev = ax_elev.text(0.99, 0.98, '', transform=ax_elev.transAxes, fontsize=12, verticalalignment='top', horizontalalignment='right')
ax_elev.text(0.99, 0.92, total_dist_text, transform=ax_elev.transAxes, fontsize=12, verticalalignment='top', horizontalalignment='right')

# データの水平・垂直スパンの比率（Elevation）
eff_elev_range = (max_elev_m + elev_range_m * 0.1) - (min_elev_m - elev_range_m * 0.1)
data_ratio_elev = (total_distance_km * 1000) / eff_elev_range if eff_elev_range > 0 else 1

# スライダー (Elevation)
ve_slider_elev = Slider(ax=ax_slider_elev, label='垂直強調', valmin=1, valmax=50, valinit=5, valstep=1)

def update_elev(val):
    vertical_exaggeration = ve_slider_elev.val
    if data_ratio_elev > 0:
        ax_elev.set_box_aspect(vertical_exaggeration / data_ratio_elev)
    
    # アスペクト比変更を適用して位置を確定させる
    fig_elev.canvas.draw()
    
    # ax_elevの新しい位置を取得
    pos = ax_elev.get_position()
    
    # ax_tableの位置を更新 (幅とX位置を同期、高さとY位置は固定)
    # ax_tableのY位置は固定(0.12)、高さも固定(0.28)
    ax_table.set_position([pos.x0, 0.28, pos.width, 0.13])
    
    ratio_text_elev.set_text(f"水平：垂直 = 1：{vertical_exaggeration}")
    # fig_elev.canvas.draw_idle() # ここでの再描画は不要かもだが念のため

ve_slider_elev.on_changed(update_elev)
update_elev(ve_slider_elev.valinit)


# --- Figure 2: 傾斜角 (Slope) ---
fig_slope, ax_slope = plt.subplots(figsize=(16, 6))
fig_slope.subplots_adjust(left=0.08, right=0.95, top=0.88, bottom=0.25)
fig_slope.canvas.manager.set_window_title('傾斜角')

# スライダー用のAxes (Slope)
ax_slider_slope = fig_slope.add_axes([0.3, 0.08, 0.4, 0.05])

ax_slope.plot(distances_km, slopes_deg, color='green', linewidth=1, label='Slope')
ax_slope.set_ylabel('傾斜角 [度]')
ax_slope.set_xlabel('距離 [km]')
ax_slope.set_title('傾斜角')
ax_slope.grid(True)
ax_slope.axhline(0, color='black', linewidth=0.5, linestyle='--')
ax_slope.set_xlim(0, total_distance_km)
ax_slope.set_xticks(x_ticks) # 同じ目盛りを使用

# Y軸は見やすいように初期範囲を設定 (-45〜45など)
slope_min, slope_max = -45, 45
ax_slope.set_ylim(slope_min, slope_max)

# テキスト情報を表示 (Slope)
ratio_text_slope = ax_slope.text(0.99, 0.98, '', transform=ax_slope.transAxes, fontsize=12, verticalalignment='top', horizontalalignment='right')

# データの水平・垂直スパンの比率（Slope）
# 傾斜角のY軸範囲を基準にする
eff_slope_range = slope_max - slope_min
# X軸はkm(1000m)、Y軸は度。直接の幾何学的意味はないが、アスペクト比調整用として比率を定義
data_ratio_slope = (total_distance_km * 1000) / eff_slope_range if eff_slope_range > 0 else 1

# スライダー (Slope)
ve_slider_slope = Slider(ax=ax_slider_slope, label='垂直強調', valmin=1, valmax=50, valinit=5, valstep=1)

def update_slope(val):
    vertical_exaggeration = ve_slider_slope.val
    # slopeの場合は単位が違うのであくまで表示上のアスペクト比調整
    if data_ratio_slope > 0:
        ax_slope.set_box_aspect((vertical_exaggeration * 10) / data_ratio_slope)

    ratio_text_slope.set_text(f"強調度: {vertical_exaggeration}")
    fig_slope.canvas.draw_idle()

ve_slider_slope.on_changed(update_slope)
update_slope(ve_slider_slope.valinit)


plt.show()
