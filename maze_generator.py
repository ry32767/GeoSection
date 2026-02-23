import random
import argparse
import sys

# 再帰制限を増やす（再帰法を使う場合のため、今回はPrim法だが念のため）
sys.setrecursionlimit(10**6)

def generate_maze(width, height):
    # 幅と高さは奇数であることを保証する
    if width % 2 == 0:
        width += 1
    if height % 2 == 0:
        height += 1

    # 壁(1)で埋め尽くされたグリッドを作成
    # 1: 壁, 0: 通路
    maze = [[1 for _ in range(width)] for _ in range(height)]

    # 開始地点 (1, 1) を通路(0)にする
    start_x, start_y = 1, 1
    maze[start_y][start_x] = 0

    # 掘り進める候補の壁リスト [(y, x, direction_y, direction_x)]
    # (y, x) は既に通路になっているセル、(dy, dx) は掘る方向
    walls = []
    
    # 上下左右の方向
    directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]

    # 開始地点の周囲の壁を候補に追加
    for dy, dx in directions:
        ny, nx = start_y + dy * 2, start_x + dx * 2
        if 0 < ny < height and 0 < nx < width:
            walls.append((start_y, start_x, dy, dx))

    while walls:
        # ランダムに壁を選ぶ (Randomized Prim's Algorithm)
        index = random.randint(0, len(walls) - 1)
        y, x, dy, dx = walls.pop(index)
        
        # 2マス先（壁の向こう側）の座標
        ny, nx = y + dy * 2, x + dx * 2

        # 2マス先が範囲内で、かつ壁(1)のままである場合のみ掘る
        if 0 < ny < height and 0 < nx < width:
            if maze[ny][nx] == 1:
                # 間の壁を通路にする
                maze[y + dy][x + dx] = 0
                # 2マス先を通路にする
                maze[ny][nx] = 0
                
                # 新しい通路(ny, nx)からさらに掘れる候補を追加
                for next_dy, next_dx in directions:
                    nny, nnx = ny + next_dy * 2, nx + next_dx * 2
                    if 0 < nny < height and 0 < nnx < width:
                        walls.append((ny, nx, next_dy, next_dx))

    return maze

def print_maze(maze, start=None, goal=None):
    height = len(maze)
    width = len(maze[0])

    for y, row in enumerate(maze):
        line = ""
        for x, cell in enumerate(row):
            if start and (x, y) == start:
                line += "S "
            elif goal and (x, y) == goal:
                line += "G "
            elif cell == 1:
                line += "##" # 壁
            else:
                line += "  " # 通路
        print(line)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="迷路生成スクリプト")
    parser.add_argument("--width", type=int, default=31, help="迷路の幅 (奇数推奨)")
    parser.add_argument("--height", type=int, default=21, help="迷路の高さ (奇数推奨)")
    args = parser.parse_args()

    width = args.width
    height = args.height
    
    # 強制的に奇数にする処理は関数内で行われるが、表示用に調整
    if width % 2 == 0: width += 1
    if height % 2 == 0: height += 1

    maze = generate_maze(width, height)
    
    # スタートとゴールを設定
    start = (1, 1)
    goal = (width - 2, height - 2)

    print(f"迷路サイズ: {width}x{height}")
    print("S: スタート, G: ゴール")
    print_maze(maze, start, goal)
